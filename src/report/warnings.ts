/**
 * A warning the run printed, kept for its reports (design
 * the-reports-carry-the-warnings, D1). The verdict is written to JUnit and HTML;
 * before this, the caveat on it lived only on stderr, which a CI job does not
 * hand its reviewer (#103). One shape for every kind: what a report reader needs
 * is what the run could not vouch for, as the terminal said it.
 */
export interface RunWarning {
  kind: 'uncommitted' | 'route-drift' | 'authoring' | 'reformatted-secret';
  /** The header line the terminal prints. */
  title: string;
  /** The rest, as printed. */
  lines: string[];
  /** Printed after a blank line on the terminal; the reports separate every warning anyway. */
  spaced?: boolean;
}

/**
 * Writes a warning to stderr, one `console.error` per line exactly as the
 * printers did before, and adds it to the run's list when there is one. The
 * reports render the same title and lines, so they cannot disagree with the
 * terminal.
 */
export function emitWarning(warning: RunWarning | undefined, into?: RunWarning[]): void {
  if (!warning) return;
  console.error(`${warning.spaced ? '\n' : ''}${warning.title}`);
  for (const line of warning.lines) console.error(line);
  into?.push(warning);
}

/** A warning as plain text, title first, for a report. */
export function warningText(warning: RunWarning): string {
  return [warning.title, ...warning.lines].join('\n');
}
