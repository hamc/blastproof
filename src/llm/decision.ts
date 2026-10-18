import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { APICallError } from 'ai';
import type { FirstJudgeConfig } from '../config.js';
import type { CallUsage } from '../runner/budget.js';
import { MissingApiKeyError } from './provider.js';

/**
 * A decision model asked before the LLM judge (design
 * a-decision-model-judges-first). A decision model takes a state and typed
 * questions and returns probabilities; it writes no text, so it can pass a step
 * and never explain a failure.
 */

/** OpenRouter's Decisions API, the only one measured (#174). */
export const DECISIONS_ENDPOINT = 'https://openrouter.ai/api/alpha/decisions';

/**
 * The most text sent to a decision model in one request, state and
 * instructions together (design D6). `liquid/d1-ultra` refuses a question over
 * 32,768 tokens with a 422, and Jev takes 32k for the state and the longest
 * question; at a conservative 2 characters per token that is about 64k
 * characters, and this keeps a margin under it. An accessibility snapshot runs
 * nearer 4 characters per token. Checked before sending: a
 * 400 does not say why it was refused, and an unknown model answers 400 too.
 */
export const MAX_DECISION_CHARS = 60_000;

/** The AI SDK's default for every LLM call: two retries, 2 s then 4 s (design D2). */
const RETRY_DELAYS_MS = [2_000, 4_000];

export interface DecisionQuestion {
  instructions: string;
  criteria: { true: string; false: string };
}

export interface DecisionAnswer {
  /** The probability of "yes", or undefined when the answer did not carry one. */
  p: number | undefined;
  usage?: CallUsage;
}

/** One question about one state. Mocked in unit tests. */
export type DecideFn = (question: DecisionQuestion, state: string, signal?: AbortSignal) => Promise<DecisionAnswer>;

type Sleep = (ms: number, signal?: AbortSignal) => Promise<void>;

const sleep: Sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });

function retryable(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

/** Reads the `noul` probability and the usage, tolerating any shape: an unreadable answer is not an error (design D5). */
function readAnswer(text: string): DecisionAnswer {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { p: undefined };
  }
  const root = (body ?? {}) as {
    answers?: { pass?: { noul?: unknown } };
    usage?: { input_tokens?: unknown; output_tokens?: unknown };
  };
  const raw = root.answers?.pass?.noul;
  const p = typeof raw === 'number' && raw >= 0 && raw <= 1 ? raw : undefined;
  // `{ input_tokens, output_tokens, cost }`, as the Decisions API answered on
  // 2026-10-18. Output is usually 0 and sometimes not: Jev reported 20.
  const input = root.usage?.input_tokens;
  const output = root.usage?.output_tokens;
  const totalTokens =
    typeof input === 'number' ? input + (typeof output === 'number' ? output : 0) : undefined;
  return { p, usage: { totalTokens } };
}

/**
 * The Decisions API client (design D2). Its failures are made in the shape the
 * choke point already converts: an error status, or no response at all, is an
 * `APICallError`, which `countedGenerate`'s handling turns into a stop of the
 * run quoting the provider. An abort is rethrown as it is, so the choke point
 * can tell the deadline from the call timeout.
 */
export function createDecisionClient(options: {
  model: string;
  apiKey: string;
  fetch?: typeof fetch;
  sleep?: Sleep;
  endpoint?: string;
}): DecideFn {
  const doFetch = options.fetch ?? fetch;
  const wait = options.sleep ?? sleep;
  const url = options.endpoint ?? DECISIONS_ENDPOINT;
  return async (question, state, signal) => {
    const requestBodyValues = {
      model: options.model,
      state,
      questions: { pass: { type: 'noul', ...question } },
    };
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await doFetch(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBodyValues),
          signal,
        });
      } catch (error) {
        if (signal?.aborted) throw error;
        if (attempt < RETRY_DELAYS_MS.length) {
          await wait(RETRY_DELAYS_MS[attempt]!, signal);
          continue;
        }
        throw new APICallError({
          message: `first judge ${options.model}: ${error instanceof Error ? error.message : String(error)}`,
          url,
          requestBodyValues,
          cause: error,
        });
      }
      const text = await response.text();
      if (response.ok) return readAnswer(text);
      if (retryable(response.status) && attempt < RETRY_DELAYS_MS.length) {
        await wait(RETRY_DELAYS_MS[attempt]!, signal);
        continue;
      }
      throw new APICallError({
        message: `first judge ${options.model}`,
        url,
        requestBodyValues,
        statusCode: response.status,
        responseBody: text,
      });
    }
  };
}

/** The first judge's own missing key: the LLM's message, with this setting's remedy. */
export class MissingFirstJudgeKeyError extends MissingApiKeyError {
  constructor(variable: string, model: string) {
    super(variable, model);
    this.message =
      `Missing API key: environment variable ${variable} is not set (required for the first judge "${model}"). ` +
      `Export it before running, e.g. \`export ${variable}=...\`, or remove first_judge from .blastproof/config.yaml ` +
      '(and unset BLASTPROOF_FIRST_JUDGE_MODEL).';
  }
}

/** What happened to one judgment the first judge was offered. */
export type FirstJudgeOutcome = 'passed' | 'label-check' | 'to-llm' | 'too-large';

export interface FirstJudgeEntry {
  step: string;
  claim: string;
  /** The masked page it read, refs removed: what a pass rests on, since it has no reason. */
  snapshot: string;
  /** Undefined when the answer carried no probability, or when it was not asked. */
  p: number | undefined;
  outcome: FirstJudgeOutcome;
}

export interface FirstJudge {
  model: string;
  threshold: number;
  decide: DecideFn;
  /** Told about every judgment it was offered. */
  record: (entry: FirstJudgeEntry) => void;
}

/**
 * What a run keeps of its first judge (design D7): the counts for the summary,
 * one total for every test even when they run at once, and `first-judge.jsonl`,
 * one line per decision call, appended as it happens so a stopped run keeps
 * what it did. Every text in it is what the judge received, masked by
 * construction.
 */
export class FirstJudgeLog {
  passed = 0;
  failedByLabelCheck = 0;
  toLlm = 0;
  private dirReady = false;

  constructor(
    readonly model: string,
    readonly threshold: number,
    private readonly file?: string,
  ) {}

  record(test: string, entry: FirstJudgeEntry): void {
    if (entry.outcome === 'passed') this.passed++;
    else if (entry.outcome === 'label-check') this.failedByLabelCheck++;
    else this.toLlm++;
    // Not asked at all, so there is no decision to keep (design D7).
    if (entry.outcome === 'too-large' || !this.file) return;
    if (!this.dirReady) {
      mkdirSync(path.dirname(this.file), { recursive: true });
      this.dirReady = true;
    }
    const line = {
      test,
      step: entry.step,
      claim: entry.claim,
      model: this.model,
      p: entry.p ?? null,
      threshold: this.threshold,
      outcome: entry.outcome,
      snapshot: entry.snapshot,
    };
    appendFileSync(this.file, `${JSON.stringify(line)}\n`, 'utf8');
  }

  summaryLine(): string {
    const labelCheck = this.failedByLabelCheck > 0 ? `, ${this.failedByLabelCheck} failed by the label check` : '';
    return (
      `First judge (experimental, ${this.model} at ${this.threshold}): ` +
      `${this.passed} passed${labelCheck}, ${this.toLlm} to the LLM judge`
    );
  }
}

/** The file a run's first-judge decisions are written to, beside its other reports. */
export function firstJudgeLogPath(sessionDir: string): string {
  return path.join(sessionDir, 'first-judge.jsonl');
}

/**
 * Resolves the configured first judge's key, failing before any browser is
 * launched when it is unset (spec first-judge). The key goes into the client and
 * nowhere else.
 */
export function createFirstJudgeClient(
  config: FirstJudgeConfig,
  env: Record<string, string | undefined> = process.env,
  fetchImpl?: typeof fetch,
): DecideFn {
  const apiKey = env[config.api_key_env];
  if (!apiKey) throw new MissingFirstJudgeKeyError(config.api_key_env, config.model);
  return createDecisionClient({ model: config.model, apiKey, fetch: fetchImpl });
}
