import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { access } from 'node:fs/promises';

const DEFAULT_CONFIG = `# blastproof configuration
# Docs: https://github.com/blastproof/blastproof

# Base URL of the app under test. Relative navigate paths resolve against it.
base_url: http://localhost:4173

llm:
  # anthropic | openai | ollama
  provider: anthropic
  # Optional. Defaults: anthropic=claude-haiku-4-5, openai=gpt-4o-mini, ollama=qwen2.5
  # model: claude-haiku-4-5
  # Env var holding your API key (not needed for ollama).
  api_key_env: ANTHROPIC_API_KEY
  # OpenAI-compatible endpoint: required for ollama (http://localhost:11434/v1);
  # with provider "openai" it enables compatible gateways, e.g. OpenRouter:
  # base_url: https://openrouter.ai/api/v1   (model e.g. anthropic/claude-haiku-4.5)

browser:
  headless: true
  timeout_ms: 30000

# Budget of self-healing retries per step (element re-resolution via accessibility tree).
# max_retries_per_step: 3

# Impact hints mapping file globs to routes (used by \`blastproof run --impacted\`).
routes:
  "src/auth/**": ["/login"]
  "src/cart/**": ["/cart", "/checkout"]

# Optional: authenticate once per run so tests and \`plan\` reach pages behind a login.
# Pick exactly ONE strategy. Credentials come from the environment via {{env.VAR}} —
# never write them here. A test can opt out with \`auth: false\` (a login test must).
#
# 1) A plain-English login journey, executed once (form login, any clickable flow):
# auth:
#   steps:
#     - navigate to /login
#     - fill the email field with {{env.TEST_EMAIL}}
#     - fill the password field with {{env.TEST_PASSWORD}}
#     - submit the login form
#   verify: a signed-in indicator is visible   # optional, but turns N failures into 1
#
# 2) A session captured by hand — for SSO, MFA or magic links, which cannot be
#    automated honestly. The file holds live session cookies: NEVER commit it.
# auth:
#   storage_state: .blastproof/auth.json
#
# 3) Static values, for token-based apps where driving a UI would be theatre:
# auth:
#   headers:
#     Authorization: "Bearer {{env.API_TOKEN}}"

# CI tip: these settings can be overridden from the environment, so you never have
# to commit a provider choice just to configure a pipeline. Precedence is
# CLI flag > environment > this file.
#   BLASTPROOF_BASE_URL          the app under test
#   BLASTPROOF_LLM_PROVIDER      anthropic | openai | ollama
#   BLASTPROOF_LLM_MODEL
#   BLASTPROOF_LLM_BASE_URL      the provider endpoint (not the app)
#   BLASTPROOF_LLM_API_KEY_ENV   name of the variable holding your key, never the key
`;

const SAMPLE_TEST = `summary: App loads and shows the home page
priority: P1
tags: [smoke]
# Routes this test covers; run --impacted selects tests by these routes.
routes: ["/"]
steps:
  - verify the home page loads and shows a heading
`;

/**
 * Keeps captured sessions and run artifacts out of git. A storage state holds live
 * session cookies: whoever has the file is signed in as that user (design D7).
 */
const GITIGNORE = `# blastproof runtime artifacts
reports/
sessions/

# Captured sessions are live credentials — never commit them.
.auth-state.json
auth.json
`;

const SAMPLE_LOGIN_TEST = `summary: Login with valid credentials succeeds
priority: P0
tags: [smoke, auth]
routes: ["/login"]
# This test exercises the login itself, so it must start signed out even when an
# auth recipe is configured.
auth: false
steps:
  - navigate to /login
  - fill the email field with demo@blastproof.dev
  - fill the password field with demo123
  - submit the login form
  - verify a welcome message is shown
# Secrets tip: use {{env.VAR_NAME}} placeholders in steps (e.g. {{env.TEST_PASSWORD}})
# and export the variable before running. Values are masked as *** in all output.
`;

export interface InitResult {
  created: string[];
  kept: string[];
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function writeIfAbsent(file: string, content: string, result: InitResult): Promise<void> {
  if (await exists(file)) {
    result.kept.push(file);
    return;
  }
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
  result.created.push(file);
}

/** Scaffolds `.blastproof/` in `cwd`. Idempotent: never overwrites existing files. */
export async function initProject(cwd: string = process.cwd()): Promise<InitResult> {
  const result: InitResult = { created: [], kept: [] };
  const root = path.join(cwd, '.blastproof');

  await writeIfAbsent(path.join(root, '.gitignore'), GITIGNORE, result);
  await writeIfAbsent(path.join(root, 'config.yaml'), DEFAULT_CONFIG, result);
  await writeIfAbsent(path.join(root, 'tests', 'app-load.yaml'), SAMPLE_TEST, result);
  await writeIfAbsent(path.join(root, 'tests', 'login.yaml'), SAMPLE_LOGIN_TEST, result);

  return result;
}

export function formatInitGuidance(result: InitResult): string {
  const lines: string[] = [];
  if (result.created.length > 0) {
    lines.push('Created:');
    for (const file of result.created) lines.push(`  ${file}`);
  }
  if (result.kept.length > 0) {
    lines.push('Kept existing (not overwritten):');
    for (const file of result.kept) lines.push(`  ${file}`);
  }
  lines.push(
    '',
    'Next steps:',
    '  1. Set your LLM API key:  export ANTHROPIC_API_KEY=...   (or OPENAI_API_KEY; ollama needs no key)',
    '  2. Point base_url at your app in .blastproof/config.yaml',
    '  3. Run your tests:        blastproof run',
    '',
    'First time with Playwright? Install the browser:  npx playwright install chromium',
  );
  return lines.join('\n');
}
