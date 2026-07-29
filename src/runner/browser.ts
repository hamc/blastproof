import { chromium, type Browser } from 'playwright';

export class BrowserLaunchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrowserLaunchError';
  }
}

export interface LaunchBrowserOptions {
  headless: boolean;
}

/** Matches the dynamic linker's own message, e.g. `libnspr4.so: cannot open shared object file`. */
const MISSING_LIBRARY_PATTERN = /([^\s:]+\.so(?:\.\d+)*): cannot open shared object file/;

/** Both casings appear across Playwright's launch and download-check code paths. */
const MISSING_EXECUTABLE_PATTERN = /executable doesn't exist/i;

/**
 * Playwright's launch failure logs the full command line it tried to run —
 * `<launching> /path/to/chrome --disable-this --disable-that ...` — sometimes
 * more than once. That is exactly the "three hundred characters of flags" that
 * buries the one line a user needs (design: never print the browser's command
 * line). A line with several `--flag` tokens is that dump, not a diagnostic, so
 * it is dropped; every other line — including the actual OS error — survives.
 */
function stripCommandLine(message: string): string {
  return message
    .split('\n')
    .filter((line) => (line.match(/\s--[\w-]+/g)?.length ?? 0) < 3)
    .join('\n')
    .trim();
}

/**
 * Wraps `chromium.launch`, translating the two causes seen in practice (design
 * D4, tasks 1.1-1.3) into a message a user can act on instead of Playwright's raw
 * exception. A cause this does not recognise still surfaces — with its command
 * line stripped — so an unanticipated failure is never swallowed to look tidy.
 */
export async function launchBrowser(options: LaunchBrowserOptions): Promise<Browser> {
  try {
    return await chromium.launch(options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (MISSING_EXECUTABLE_PATTERN.test(message)) {
      throw new BrowserLaunchError(
        'The browser is not installed. Run `npx playwright install chromium` to download it.',
      );
    }

    const missingLibrary = message.match(MISSING_LIBRARY_PATTERN);
    if (missingLibrary) {
      throw new BrowserLaunchError(
        `The browser could not start because a system library is missing: ${missingLibrary[1]}. ` +
          'Run `npx playwright install-deps chromium` to install it — this needs root/administrator ' +
          "privileges (sudo, or an elevated shell on Windows). Without them, blastproof run --dry-run " +
          'and blastproof plan --dry-run need neither a browser nor a key.',
      );
    }

    throw new BrowserLaunchError(stripCommandLine(message));
  }
}
