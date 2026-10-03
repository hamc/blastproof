import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { AssertJudgment } from '../../src/llm/schemas.js';
import type { StepHistoryEntry } from '../../src/runner/recovery.js';

/**
 * The judge regression corpus (design ask-the-judge-about-the-step, D4).
 *
 * Every change to the verdict so far was verified against its own reproduction
 * and a dogfood suite containing none of the cases that broke it, so nothing
 * would have shown a later change reopening an earlier one. Each case here is
 * exactly what the judge reads, with the verdict a correct judge returns.
 *
 * Masked text only: a case holds `[redacted NAME]` where a value was.
 */
const caseSchema = z.object({
  id: z.string().min(1),
  verdict: z.enum(['PASS', 'FAIL']),
  step: z.string().min(1),
  expectation: z.string().min(1),
  snapshot: z.string().min(1),
  history: z.array(z.object({ action: z.string(), result: z.string() })),
  provenance: z.object({
    // captured: copied from a real run's judge input. reconstructed: rebuilt
    // where no capture exists, citing what it was built from, so a reader can
    // weigh it as the weaker evidence it is.
    kind: z.enum(['captured', 'reconstructed']),
    source: z.string().min(1),
  }),
  note: z.string().optional(),
  /**
   * The issue a case is judged wrong under, today. Expected to fail, so it does
   * not fail the run; reported when it starts passing, so the marker is removed
   * rather than outliving its bug.
   */
  knownFailing: z.string().regex(/^#\d+$/).optional(),
});

const incidentSchema = z.object({
  incident: z.string().regex(/^#\d+$/),
  summary: z.string().min(1),
  cases: z.array(caseSchema).min(1),
});

export type JudgeCase = z.infer<typeof caseSchema> & { incident: string; file: string };

export const CASES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'cases');

/** Loads and validates every incident file. Throws on the first malformed one, naming it. */
export function loadCorpus(dir: string = CASES_DIR): JudgeCase[] {
  const cases: JudgeCase[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const parsed = incidentSchema.safeParse(JSON.parse(readFileSync(path.join(dir, file), 'utf8')));
    if (!parsed.success) {
      throw new Error(`${file}: ${parsed.error.issues[0]?.path.join('.')}: ${parsed.error.issues[0]?.message}`);
    }
    for (const c of parsed.data.cases) cases.push({ ...c, incident: parsed.data.incident, file });
  }
  return cases;
}

export type Judge = (
  step: string,
  expectation: string,
  snapshot: string,
  history: StepHistoryEntry[],
) => Promise<AssertJudgment>;

export interface CaseResult {
  case: JudgeCase;
  right: number;
  samples: number;
  /** A reason from a wrong sample, for the report. */
  wrongReason?: string;
}

export interface CorpusOutcome {
  results: CaseResult[];
  /** Cases not marked knownFailing that were judged wrong in any sample. */
  regressions: CaseResult[];
  /** Cases marked knownFailing that were judged right in every sample. */
  nowPassing: CaseResult[];
}

/**
 * Replays every case `samples` times. A case is right only when every sample
 * is: the judge runs at temperature 0, so one wrong sample is a verdict a gate
 * can return, not noise to average away.
 */
export async function runCorpus(cases: JudgeCase[], judge: Judge, samples: number): Promise<CorpusOutcome> {
  const results: CaseResult[] = [];
  for (const c of cases) {
    let right = 0;
    let wrongReason: string | undefined;
    for (let i = 0; i < samples; i++) {
      const judgment = await judge(c.step, c.expectation, c.snapshot, c.history);
      if (judgment.pass === (c.verdict === 'PASS')) right++;
      else wrongReason = judgment.reason;
    }
    results.push({ case: c, right, samples, wrongReason });
  }
  return {
    results,
    regressions: results.filter((r) => !r.case.knownFailing && r.right < r.samples),
    nowPassing: results.filter((r) => r.case.knownFailing && r.right === r.samples),
  };
}
