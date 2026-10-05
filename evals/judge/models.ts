/**
 * The models a replay runs on (design replay-the-judge-corpus-on-two-models, D1):
 * `EVAL_MODELS`, comma-separated, each resolved through the configured provider
 * with only the model replaced. Unset or empty, the configured model alone.
 *
 * Its own module so the parsing is testable without a key: `run.ts` replays on
 * import.
 */
export function evalModels(list: string | undefined, configured: string): string[] {
  const models = (list ?? '')
    .split(',')
    .map((model) => model.trim())
    .filter((model) => model.length > 0);
  return models.length > 0 ? [...new Set(models)] : [configured];
}
