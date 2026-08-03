/**
 * Error thrown by report writers when a file-system write fails. Carries a
 * house-style message (plain prose, no errno code) so callers can surface it
 * directly to the user.
 */
export class ReportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReportError';
  }
}

/**
 * Reduces a Node fs error to plain prose: drops the leading errno code
 * (`EACCES:`, `EISDIR:`, …) and the trailing `, <syscall> '<path>'` (the path
 * is already named in the surrounding message). Non-Error throws pass through.
 */
export function fsReason(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return error.message
    .replace(/^E[A-Z]+:\s*/, '')
    .replace(/,\s+\w+\s+'[^']*'$/, '')
    .trim();
}
