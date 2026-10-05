import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { AssertJudgment } from '../../src/llm/schemas.js';
import { RunStoppedError } from '../../src/runner/budget.js';
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
 *
 * An answer that could not be used is a wrong sample, not the end of the replay
 * (design replay-the-judge-corpus-on-two-models, D4): one completion cut off
 * mid-JSON aborted a whole replay, and no case after it was judged. A stop of
 * the run (#125) still ends it, since every sample after an exhausted balance
 * would be wrong for a reason that is not the judge's.
 */
export async function runCorpus(cases: JudgeCase[], judge: Judge, samples: number): Promise<CorpusOutcome> {
  const results: CaseResult[] = [];
  for (const c of cases) {
    let right = 0;
    let wrongReason: string | undefined;
    for (let i = 0; i < samples; i++) {
      let judgment: AssertJudgment;
      try {
        judgment = await judge(c.step, c.expectation, c.snapshot, c.history);
      } catch (error) {
        if (error instanceof RunStoppedError) throw error;
        wrongReason = `error: ${error instanceof Error ? error.message : String(error)}`;
        continue;
      }
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

/** One case's results, one per model, in the order the models were given. */
export interface CaseAcrossModels {
  case: JudgeCase;
  perModel: Array<{ model: string; result: CaseResult }>;
}

export interface ModelsOutcome {
  models: string[];
  results: CaseAcrossModels[];
  /** Cases not marked knownFailing that were judged wrong on any model. */
  regressions: CaseAcrossModels[];
  /** Cases marked knownFailing that were judged right on every model. */
  nowPassing: CaseAcrossModels[];
}

/** The models that judged a case wrong in at least one sample. */
export function wrongOn(entry: CaseAcrossModels): string[] {
  return entry.perModel.filter(({ result }) => result.right < result.samples).map(({ model }) => model);
}

/**
 * Replays the corpus on each model in turn (design
 * replay-the-judge-corpus-on-two-models, D3). A regression on any model is a
 * regression: a fix that holds on one model only may be a quirk of that model.
 * A known failure is only reported fixed when every model gets it right, since
 * a bug still reaching the default model is still open (#129 is right on one
 * model of the reference pair and wrong on the other).
 */
export async function runCorpusOnModels(
  cases: JudgeCase[],
  judges: Array<{ model: string; judge: Judge }>,
  samples: number,
): Promise<ModelsOutcome> {
  const perModel: Array<{ model: string; outcome: CorpusOutcome }> = [];
  for (const { model, judge } of judges) perModel.push({ model, outcome: await runCorpus(cases, judge, samples) });
  const results: CaseAcrossModels[] = cases.map((c, i) => ({
    case: c,
    perModel: perModel.map(({ model, outcome }) => ({ model, result: outcome.results[i]! })),
  }));
  return {
    models: judges.map(({ model }) => model),
    results,
    regressions: results.filter((r) => !r.case.knownFailing && wrongOn(r).length > 0),
    nowPassing: results.filter((r) => r.case.knownFailing && wrongOn(r).length === 0),
  };
}
