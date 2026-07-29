import path from 'node:path';
import { chromium } from 'playwright';
import { authenticate, AuthError, contextOptions, type AuthSession, type BrowserLike } from '../auth.js';
import { ConfigError, loadConfig, type BlastproofConfig } from '../config.js';
import { DiffError, getChangedFiles } from '../diff.js';
import { mapImpact } from '../impact.js';
import { createBrain, createPlanner } from '../llm/brain.js';
import { createModel, MissingApiKeyError } from '../llm/provider.js';
import {
  coveredRoutes,
  generateForRoute,
  PlannerError,
  renderTestYaml,
  writeDraft,
  type TestDraft,
} from '../planner.js';
import type { PageLike } from '../runner/actions.js';
import { BudgetExhaustedError, RunBudget } from '../runner/budget.js';
import type { ExecutorEvent } from '../runner/executor.js';
import {
  discoverTestFiles,
  parseTestFile,
  TESTS_RELATIVE_DIR,
  TestFileError,
  type TestFile,
} from '../runner/testfile.js';
import { SecretsMask } from '../runner/env.js';
import {
  applyUrlOverride,
  EXIT_FAILED,
  EXIT_OK,
  EXIT_USAGE,
  resolveBudgetOptions,
  type BudgetFlags,
} from './run.js';

export interface PlanOptions extends BudgetFlags {
  cwd: string;
  /** Base git ref for the diff (default "main"). Ignored when `routes` is given. */
  base?: string;
  /** Overrides config base_url for this run only; the config file is never mutated. */
  url?: string;
  /** Explicit routes (`--route`), bypassing diff and impact analysis entirely. */
  routes?: string[];
  /** Persist drafts under `.blastproof/tests/` instead of previewing them. */
  write?: boolean;
  /**
   * A budget already constructed by a composing caller (`test`), so both phases
   * share one allowance. When absent, resolved here from `flag > env > file`.
   */
  budget?: RunBudget;
}

/** Prints login-journey progress, so a failing authentication is not a black box. */
function printAuthEvent(event: ExecutorEvent): void {
  if (event.type === 'step-start') {
    console.log(`  step ${event.index + 1}/${event.total}: ${event.step}`);
  } else if (event.type === 'action') {
    console.log(`    -> ${event.action.action} :: ${event.result}`);
  } else if (event.status === 'failed') {
    console.log(`    X step failed: ${event.reason ?? 'unknown reason'}`);
  }
}

/** Loads the suite, tolerating unreadable files (a broken test must not block planning). */
async function loadSuite(cwd: string): Promise<TestFile[]> {
  const testsDir = path.join(cwd, TESTS_RELATIVE_DIR);
  let files: string[];
  try {
    files = await discoverTestFiles(testsDir);
  } catch {
    return [];
  }

  const parsed: TestFile[] = [];
  for (const file of files) {
    try {
      parsed.push(await parseTestFile(file));
    } catch (error) {
      if (error instanceof TestFileError) continue;
      throw error;
    }
  }
  return parsed;
}

interface RouteWork {
  route: string;
  /** Changed files that mapped to this route; empty under `--route`. */
  changedFiles: string[];
}

/** Resolves which routes to generate for, plus the routes skipped as already covered. */
async function resolveTargets(
  options: PlanOptions,
  config: BlastproofConfig,
  suite: TestFile[],
): Promise<{ work: RouteWork[]; alreadyCovered: string[] }> {
  const covered = coveredRoutes(suite);

  if (options.routes && options.routes.length > 0) {
    return { work: options.routes.map((route) => ({ route, changedFiles: [] })), alreadyCovered: [] };
  }

  const base = options.base ?? 'main';
  const changedFiles = await getChangedFiles(base, options.cwd);
  const impact = mapImpact(changedFiles, config.routes ?? {}, config.ignore ?? []);

  // Re-run the glob match per route so each generation prompt sees only the files
  // that made *that* route impacted (design D3), not the whole changed set.
  const filesForRoute = (route: string): string[] =>
    changedFiles.filter((file) =>
      mapImpact([file], config.routes ?? {}, config.ignore ?? []).affectedRoutes.includes(route),
    );

  const work: RouteWork[] = [];
  const alreadyCovered: string[] = [];
  for (const route of impact.affectedRoutes) {
    if (covered.has(route)) {
      alreadyCovered.push(route);
      continue;
    }
    work.push({ route, changedFiles: filesForRoute(route) });
  }
  return { work, alreadyCovered };
}

/**
 * `blastproof plan`: diff → impact → uncovered routes → snapshot-grounded test drafts.
 * Preview by default; `--write` persists without ever overwriting (design D7).
 * Returns the exit code: 0 all generated (or nothing to do), 1 any route failed or
 * the run's budget/deadline stopped it before every route was attempted (spec
 * run-budget), 2 usage/config/diff error.
 */
export async function planCommand(options: PlanOptions): Promise<number> {
  let config: BlastproofConfig;
  try {
    config = applyUrlOverride(await loadConfig(options.cwd), options.url);
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`error: ${error.message}`);
      return EXIT_USAGE;
    }
    throw error;
  }

  const suite = await loadSuite(options.cwd);

  let work: RouteWork[];
  let alreadyCovered: string[];
  try {
    ({ work, alreadyCovered } = await resolveTargets(options, config, suite));
  } catch (error) {
    if (error instanceof DiffError) {
      console.error(`error: ${error.message}`);
      return EXIT_USAGE;
    }
    throw error;
  }

  if (alreadyCovered.length > 0) {
    console.log('Already covered (skipped):');
    for (const route of alreadyCovered) console.log(`  ${route}`);
  }

  // Nothing to generate: no browser, no LLM key required.
  if (work.length === 0) {
    console.log('Nothing to generate: no affected route is missing coverage.');
    return EXIT_OK;
  }

  // Fail fast on a missing API key before launching any browser, as `run` does.
  try {
    createModel(config.llm);
  } catch (error) {
    if (error instanceof MissingApiKeyError) {
      console.error(`error: ${error.message}`);
      return EXIT_USAGE;
    }
    throw error;
  }

  const { model, provider, modelId } = createModel(config.llm);
  // Unconfigured (the common case) never binds. A composing caller (`test`) may
  // hand in an already-started budget so both phases share one allowance instead
  // of `plan` resolving a fresh one (spec run-budget counts test planning too).
  const budget = options.budget ?? new RunBudget(resolveBudgetOptions(config, options));
  const brain = createPlanner(model, undefined, budget);
  const base = options.routes && options.routes.length > 0 ? undefined : (options.base ?? 'main');
  console.log(
    `blastproof plan: ${work.length} route(s), provider=${provider} model=${modelId}, base_url=${config.base_url}`,
  );

  // Same scope as `run`: the auth credential plus every placeholder in the suite.
  const mask = new SecretsMask();
  for (const step of config.auth?.steps ?? []) mask.registerFrom(step);
  for (const value of Object.values(config.auth?.headers ?? {})) mask.registerFrom(value);
  for (const cookie of config.auth?.cookies ?? []) mask.registerFrom(cookie.value);
  for (const test of suite) {
    for (const step of [...(test.setup ?? []), ...test.steps]) mask.registerFrom(step);
  }

  const generated: string[] = [];
  const written: string[] = [];
  const failed: { route: string; reason: string }[] = [];
  // Set only by a budget/deadline stop (design D3): a route never reaches a real
  // failure once this is set, so `notAttempted` — not `failed` — is what remains.
  let incomplete: BudgetExhaustedError | undefined;

  const browser = await chromium.launch({ headless: config.browser.headless });
  try {
    // The planner authenticates too (design D8): without a session it would snapshot
    // the login wall and draft a test for that instead of for the actual feature.
    let session: AuthSession | undefined;
    if (config.auth) {
      try {
        console.log('Authenticating...');
        session = await authenticate({
          auth: config.auth,
          cwd: options.cwd,
          baseUrl: config.base_url,
          allowedOrigins: config.allowed_origins,
          browser: browser as unknown as BrowserLike,
          brain: createBrain(createModel(config.llm).model, undefined, budget),
          maxRetries: config.max_retries_per_step,
          mask,
          onEvent: printAuthEvent,
        });
      } catch (error) {
        if (error instanceof BudgetExhaustedError) {
          incomplete = error;
        } else if (error instanceof AuthError) {
          console.error(`error: ${error.message}`);
          return EXIT_USAGE;
        } else {
          throw error;
        }
      }
    }

    // The budget or deadline ran out during login: no route was ever attempted.
    for (const { route, changedFiles } of incomplete ? [] : work) {
      console.log(`\n> ${route}`);
      let draft: TestDraft;
      const context = await browser.newContext(contextOptions(session));
      try {
        const page = await context.newPage();
        page.setDefaultTimeout(config.browser.timeout_ms);
        draft = await generateForRoute(page as unknown as PageLike, {
          route,
          baseUrl: config.base_url,
          changedFiles,
          brain,
          mask: (text) => mask.mask(text),
        });
      } catch (error) {
        if (error instanceof BudgetExhaustedError) {
          // Not a route failure (design D3): the run's allowance ran out, so this
          // route and everything after it stop here rather than being misreported
          // as a generation defect.
          incomplete = error;
          break;
        }
        // Per-route isolation (design D9): report and keep going.
        failed.push({ route, reason: error instanceof Error ? error.message : String(error) });
        console.log(`  X failed: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      } finally {
        await context.close();
      }

      generated.push(route);
      if (options.write) {
        try {
          const file = await writeDraft(options.cwd, draft, { route, base });
          written.push(path.relative(options.cwd, file));
          console.log(`  wrote ${path.relative(options.cwd, file)}`);
        } catch (error) {
          if (error instanceof PlannerError) {
            generated.pop();
            failed.push({ route, reason: error.message });
            console.log(`  X failed: ${error.message}`);
            continue;
          }
          throw error;
        }
      } else {
        console.log(`\n${renderTestYaml(draft, { route, base })}`);
      }
    }
  } finally {
    await browser.close();
  }

  const notAttempted = incomplete
    ? work.map((item) => item.route).filter((route) => !generated.includes(route) && !failed.some((f) => f.route === route))
    : [];

  console.log('\n--- Plan -------------------------------------------------------');
  console.log(`Generated: ${generated.length > 0 ? generated.join(', ') : 'none'}`);
  if (written.length > 0) {
    console.log('Written:');
    for (const file of written) console.log(`  ${file}`);
  }
  if (!options.write && generated.length > 0) {
    console.log('Preview only: no files written. Re-run with --write to persist.');
  }
  if (failed.length > 0) {
    console.log('Failed:');
    for (const { route, reason } of failed) console.log(`  ${route}: ${reason}`);
  }
  if (incomplete) {
    // Never a quiet success (design D4's reasoning applies here too): a budget or
    // deadline stop is reported, not swallowed into "nothing to generate".
    console.log(`Stopped: ${incomplete.message}`);
    if (notAttempted.length > 0) {
      console.log('Not attempted (run out of budget):');
      for (const route of notAttempted) console.log(`  ${route}`);
    }
  }
  console.log('---------------------------------------------------------------');

  return incomplete || failed.length > 0 ? EXIT_FAILED : EXIT_OK;
}
