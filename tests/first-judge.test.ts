import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LanguageModel } from 'ai';
import { createBrain, type GenerateObjectFn } from '../src/llm/brain.js';
import {
  createDecisionClient,
  createFirstJudgeClient,
  FirstJudgeLog,
  MAX_DECISION_CHARS,
  type DecideFn,
  type DecisionQuestion,
  type FirstJudge,
  type FirstJudgeEntry,
} from '../src/llm/decision.js';
import { firstJudgeQuestion } from '../src/llm/prompts.js';
import { MissingApiKeyError } from '../src/llm/provider.js';
import { assertJudgmentSchema } from '../src/llm/schemas.js';
import { ModelCallTimeoutError, ProviderRefusedError, RunBudget } from '../src/runner/budget.js';

const fakeModel = { provider: 'test', modelId: 'test-model' } as unknown as LanguageModel;
const question: DecisionQuestion = { instructions: 'i', criteria: { true: 't', false: 'f' } };
const noSleep = async () => {};

function answer(body: unknown, status = 200): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
}

describe('the decision client (design a-decision-model-judges-first, D2)', () => {
  it('posts one noul question about the state and reads its probability and usage', async () => {
    const sent: { url?: string; init?: RequestInit } = {};
    const decide = createDecisionClient({
      model: 'liquid/d1-ultra',
      apiKey: 'sk-test',
      fetch: async (url, init) => {
        sent.url = String(url);
        sent.init = init;
        return answer({
          model: 'liquid/d1-ultra-20261015',
          answers: { pass: { type: 'noul', noul: 0.93 } },
          usage: { input_tokens: 1200, output_tokens: 0, cost: 0.00005 },
        });
      },
    });

    const result = await decide(question, 'the page', undefined);

    expect(result).toEqual({ p: 0.93, usage: { totalTokens: 1200 } });
    expect(sent.url).toBe('https://openrouter.ai/api/alpha/decisions');
    expect(JSON.parse(String(sent.init?.body))).toEqual({
      model: 'liquid/d1-ultra',
      state: 'the page',
      questions: { pass: { type: 'noul', instructions: 'i', criteria: { true: 't', false: 'f' } } },
    });
    expect((sent.init?.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
  });

  it.each([
    ['no JSON', 'not json'],
    ['no probability', { answers: {} }],
    ['a probability out of range', { answers: { pass: { noul: 1.4 } } }],
  ])('returns no probability for an answer with %s, rather than failing', async (_, body) => {
    const decide = createDecisionClient({ model: 'm', apiKey: 'k', fetch: async () => answer(body) });
    expect((await decide(question, 's')).p).toBeUndefined();
  });

  it('throws an error status as an APICallError carrying the status and the body, without retrying a 401', async () => {
    let calls = 0;
    const decide = createDecisionClient({
      model: 'm',
      apiKey: 'k',
      sleep: noSleep,
      fetch: async () => {
        calls++;
        return answer('{"error":"No auth credentials found"}', 401);
      },
    });
    await expect(decide(question, 's')).rejects.toMatchObject({ statusCode: 401, responseBody: '{"error":"No auth credentials found"}' });
    expect(calls).toBe(1);
  });

  it('retries a 503 twice, as the AI SDK does, and returns the answer that came back', async () => {
    let calls = 0;
    const waits: number[] = [];
    const decide = createDecisionClient({
      model: 'm',
      apiKey: 'k',
      sleep: async (ms) => {
        waits.push(ms);
      },
      fetch: async () => (++calls < 3 ? answer('busy', 503) : answer({ answers: { pass: { noul: 0.2 } } })),
    });
    expect((await decide(question, 's')).p).toBe(0.2);
    expect(waits).toEqual([2000, 4000]);
  });

  it('gives up on a network failure after the retries, as an APICallError with no status', async () => {
    let calls = 0;
    const decide = createDecisionClient({
      model: 'm',
      apiKey: 'k',
      sleep: noSleep,
      fetch: async () => {
        calls++;
        throw new TypeError('fetch failed');
      },
    });
    await expect(decide(question, 's')).rejects.toMatchObject({ statusCode: undefined });
    expect(calls).toBe(3);
  });

  it('does not retry once aborted', async () => {
    let calls = 0;
    const controller = new AbortController();
    const decide = createDecisionClient({
      model: 'm',
      apiKey: 'k',
      sleep: noSleep,
      fetch: async () => {
        calls++;
        controller.abort();
        throw new DOMException('aborted', 'AbortError');
      },
    });
    await expect(decide(question, 's', controller.signal)).rejects.toThrow('aborted');
    expect(calls).toBe(1);
  });
});

describe('the first judge key (spec first-judge)', () => {
  const config = { model: 'liquid/d1-ultra', api_key_env: 'OPENROUTER_API_KEY', threshold: 0.7 };

  it('fails, naming the variable and the model, when the key is unset', () => {
    let thrown: unknown;
    try {
      createFirstJudgeClient(config, {});
    } catch (error) {
      thrown = error;
    }
    // A MissingApiKeyError, so the commands' existing fail-fast handling catches it.
    expect(thrown).toBeInstanceOf(MissingApiKeyError);
    expect((thrown as Error).message).toContain('OPENROUTER_API_KEY');
    expect((thrown as Error).message).toContain('"liquid/d1-ultra"');
    expect((thrown as Error).message).toContain('export OPENROUTER_API_KEY=');
  });

  it('treats an empty key as unset', () => {
    expect(() => createFirstJudgeClient(config, { OPENROUTER_API_KEY: '' })).toThrow(MissingApiKeyError);
  });
});

/** A brain whose LLM judge answers `llm` and counts its calls, with `decide` in front of it. */
function judgeWith(decide: DecideFn, llm = { outcome: 'o', reason: 'the LLM said so', pass: false }) {
  const entries: FirstJudgeEntry[] = [];
  const prompts: string[] = [];
  let llmCalls = 0;
  const generate: GenerateObjectFn = async (options) => {
    if (options.schema !== assertJudgmentSchema) throw new Error('only judgments here');
    llmCalls++;
    return { object: llm, usage: { totalTokens: 10 } };
  };
  const firstJudge: FirstJudge = {
    model: 'liquid/d1-ultra',
    threshold: 0.7,
    decide: async (q, state, signal) => {
      prompts.push(state);
      return decide(q, state, signal);
    },
    record: (entry) => entries.push(entry),
  };
  const budget = new RunBudget();
  const brain = createBrain(fakeModel, generate, budget, firstJudge);
  return { brain, entries, prompts, budget, llmCalls: () => llmCalls };
}

describe('judge() with a first judge (spec first-judge, design D5)', () => {
  it('passes a step at or above the threshold without an LLM call, and says who passed it', async () => {
    const t = judgeWith(async () => ({ p: 0.93 }));
    const judgment = await t.brain.judge('verify the heading "Notes"', 'the heading is shown', '- heading "Notes"');

    expect(judgment.pass).toBe(true);
    expect(judgment.reason).toContain('liquid/d1-ultra');
    expect(judgment.reason).toContain('0.93');
    expect(judgment.reason).toContain('gives no reason');
    expect(t.llmCalls()).toBe(0);
    expect(t.entries.map((e) => e.outcome)).toEqual(['passed']);
    expect(t.budget.spend().calls).toBe(1);
  });

  it('passes exactly at the threshold', async () => {
    const t = judgeWith(async () => ({ p: 0.7 }));
    expect((await t.brain.judge('s', 'c', 'page')).pass).toBe(true);
    expect(t.llmCalls()).toBe(0);
  });

  it('sends a judgment below the threshold to the LLM judge, whose verdict and reason stand', async () => {
    const t = judgeWith(async () => ({ p: 0.4 }));
    const judgment = await t.brain.judge('s', 'c', 'page');

    expect(judgment).toMatchObject({ pass: false, reason: 'the LLM said so' });
    expect(t.llmCalls()).toBe(1);
    expect(t.entries).toMatchObject([{ outcome: 'to-llm', p: 0.4 }]);
    expect(t.budget.spend().calls).toBe(2);
  });

  it('sends an answer with no probability to the LLM judge', async () => {
    const t = judgeWith(async () => ({ p: undefined }));
    await t.brain.judge('s', 'c', 'page');
    expect(t.llmCalls()).toBe(1);
    expect(t.entries).toMatchObject([{ outcome: 'to-llm', p: undefined }]);
  });

  it('does not ask about a page too large for it, and the LLM judge decides', async () => {
    let asked = false;
    const t = judgeWith(async () => {
      asked = true;
      return { p: 0.99 };
    });
    await t.brain.judge('s', 'c', 'x'.repeat(MAX_DECISION_CHARS));
    expect(asked).toBe(false);
    expect(t.llmCalls()).toBe(1);
    expect(t.entries.map((e) => e.outcome)).toEqual(['too-large']);
    expect(t.budget.spend().calls).toBe(1);
  });

  it('fails a confident pass on a step naming a secret the page shows another of, with no LLM call', async () => {
    const t = judgeWith(async () => ({ p: 0.95 }));
    const judgment = await t.brain.judge(
      'verify the account shows {{env.TEST_EMAIL}}',
      'the email is shown',
      '- text "Signed in as [redacted TEST_OTHER]"',
    );
    expect(judgment.pass).toBe(false);
    expect(judgment.reason).toContain('[redacted TEST_EMAIL]');
    expect(t.llmCalls()).toBe(0);
    expect(t.entries.map((e) => e.outcome)).toEqual(['label-check']);
  });

  it('reads what the LLM judge reads: placeholders as labels, never the placeholder', async () => {
    const t = judgeWith(async () => ({ p: 0.95 }));
    await t.brain.judge(
      'log in with {{env.PASSWORD}} and verify the dashboard',
      'typed {{env.PASSWORD}}',
      '- heading "Dashboard"',
      [{ action: 'fill "Password" with {{env.PASSWORD}}', result: 'ok' }],
    );
    expect(t.prompts[0]).toContain('[redacted PASSWORD]');
    expect(t.prompts[0]).not.toContain('{{env.PASSWORD}}');
    expect(t.entries[0]!.step).toBe('log in with [redacted PASSWORD] and verify the dashboard');
    expect(t.entries[0]!.claim).toBe('typed [redacted PASSWORD]');
  });

  it('is asked the shipped question', async () => {
    let asked: DecisionQuestion | undefined;
    const t = judgeWith(async (q) => {
      asked = q;
      return { p: 0.9 };
    });
    await t.brain.judge('s', 'c', 'page');
    expect(asked).toEqual(firstJudgeQuestion());
    expect(asked!.instructions).not.toContain('Answer with pass=true/false');
  });

  it('stops the run when the decision endpoint refuses, as for any provider', async () => {
    const t = judgeWith(createDecisionClient({ model: 'm', apiKey: 'k', fetch: async () => answer('bad key', 401) }));
    await expect(t.brain.judge('s', 'c', 'page')).rejects.toBeInstanceOf(ProviderRefusedError);
    expect(t.llmCalls()).toBe(0);
  });

  it('is bounded by llm.timeout_s like every model call', async () => {
    const generate: GenerateObjectFn = async () => ({ object: { outcome: 'o', reason: 'r', pass: true } });
    const budget = new RunBudget({ callTimeoutMs: 20 });
    const brain = createBrain(fakeModel, generate, budget, {
      model: 'm',
      threshold: 0.7,
      record: () => {},
      decide: (_q, _s, signal) =>
        new Promise((_, reject) => signal?.addEventListener('abort', () => reject(new Error('aborted')))),
    });
    await expect(brain.judge('s', 'c', 'page')).rejects.toBeInstanceOf(ModelCallTimeoutError);
  });

  it('is never asked when the budget is already spent', async () => {
    let asked = false;
    const budget = new RunBudget({ maxCalls: 1 });
    budget.record(undefined);
    const brain = createBrain(fakeModel, async () => ({ object: {} }), budget, {
      model: 'm',
      threshold: 0.7,
      record: () => {},
      decide: async () => {
        asked = true;
        return { p: 1 };
      },
    });
    await expect(brain.judge('s', 'c', 'page')).rejects.toThrow(/budget/i);
    expect(asked).toBe(false);
  });
});

describe('what a run keeps of its first judge (design D7)', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'blastproof-first-judge-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('counts every judgment and writes one line per decision, the page included', async () => {
    const file = path.join(dir, 'session', 'first-judge.jsonl');
    const log = new FirstJudgeLog('liquid/d1-ultra', 0.7, file);
    const base = { step: 'verify [redacted EMAIL] is shown', claim: 'c', snapshot: '- text "[redacted EMAIL]"' };
    log.record('.blastproof/tests/a.yaml', { ...base, p: 0.91, outcome: 'passed' });
    log.record('.blastproof/tests/a.yaml', { ...base, p: 0.3, outcome: 'to-llm' });
    log.record('.blastproof/tests/b.yaml', { ...base, p: 0.95, outcome: 'label-check' });
    log.record('.blastproof/tests/b.yaml', { ...base, p: undefined, outcome: 'too-large' });

    expect(log.summaryLine()).toBe(
      'First judge (experimental, liquid/d1-ultra at 0.7): 1 passed, 1 failed by the label check, 2 to the LLM judge',
    );
    const lines = (await readFile(file, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    // The too-large judgment was never asked, so it has no line.
    expect(lines).toHaveLength(3);
    expect(lines[0]).toEqual({
      test: '.blastproof/tests/a.yaml',
      step: 'verify [redacted EMAIL] is shown',
      claim: 'c',
      model: 'liquid/d1-ultra',
      p: 0.91,
      threshold: 0.7,
      outcome: 'passed',
      snapshot: '- text "[redacted EMAIL]"',
    });
  });

  it('leaves out the label-check clause when nothing failed it', () => {
    const log = new FirstJudgeLog('m', 0.8);
    log.record('t', { step: 's', claim: 'c', snapshot: 'p', p: 0.9, outcome: 'passed' });
    expect(log.summaryLine()).toBe('First judge (experimental, m at 0.8): 1 passed, 0 to the LLM judge');
  });
});
