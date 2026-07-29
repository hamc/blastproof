import { describe, expect, it, vi } from 'vitest';

const { launchMock } = vi.hoisted(() => ({ launchMock: vi.fn() }));

vi.mock('playwright', () => ({ chromium: { launch: launchMock } }));

import { BrowserLaunchError, launchBrowser } from '../src/runner/browser.js';

describe('launchBrowser', () => {
  it('launches normally when nothing is wrong', async () => {
    const browser = { close: vi.fn() };
    launchMock.mockResolvedValue(browser);

    await expect(launchBrowser({ headless: true })).resolves.toBe(browser);
  });

  it('names the missing shared library and its remedy, without the command line', async () => {
    // The command line Playwright reports alongside the real cause — a
    // <launching> log line with dozens of --disable-* flags — is exactly what
    // must never reach the terminal (design: never print the browser's command
    // line). Only the diagnostic line should survive.
    launchMock.mockRejectedValue(
      new Error(
        [
          'Failed to launch the browser process.',
          'Browser logs:',
          '<launching> /home/user/.cache/ms-playwright/chromium-1000/chrome-linux/chrome ' +
            '--disable-field-trial-config --disable-background-networking --disable-back-forward-cache ' +
            '--disable-breakpad --disable-client-side-phishing-detection --disable-component-update ' +
            '--disable-default-apps --disable-dev-shm-usage --disable-extensions --disable-hang-monitor',
          '/home/user/.cache/ms-playwright/chromium-1000/chrome-linux/chrome: error while loading ' +
            'shared libraries: libnspr4.so: cannot open shared object file: No such file or directory',
        ].join('\n'),
      ),
    );

    const error = await launchBrowser({ headless: true }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BrowserLaunchError);
    const message = (error as Error).message;
    // Names the missing component and the remedy.
    expect(message).toContain('libnspr4.so');
    expect(message).toContain('npx playwright install-deps chromium');
    // States that installing system libraries needs elevated privileges.
    expect(message).toMatch(/root|administrator|sudo/i);
    // Never the browser's command line.
    expect(message).not.toContain('--disable-field-trial-config');
    expect(message).not.toContain('<launching>');
  });

  it('says the browser was never installed and names the install command', async () => {
    launchMock.mockRejectedValue(
      new Error(
        "Executable doesn't exist at /home/user/.cache/ms-playwright/chromium-1000/chrome-linux/chrome\n" +
          'Looks like Playwright was just installed or updated.\nPlease run the following command:\n\n' +
          '    npx playwright install',
      ),
    );

    const error = await launchBrowser({ headless: true }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BrowserLaunchError);
    const message = (error as Error).message;
    expect(message).toMatch(/not installed/i);
    expect(message).toContain('npx playwright install chromium');
  });

  it('keeps an unrecognised cause visible, with its command line stripped', async () => {
    launchMock.mockRejectedValue(
      new Error(
        [
          'Failed to launch the browser process.',
          'Browser logs:',
          '<launching> /path/to/chrome --disable-a --disable-b --disable-c --disable-d --disable-e',
          'Some unforeseen crash reason nobody pattern-matched for.',
        ].join('\n'),
      ),
    );

    const error = await launchBrowser({ headless: true }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BrowserLaunchError);
    const message = (error as Error).message;
    // The underlying error is never swallowed (design D4).
    expect(message).toContain('Some unforeseen crash reason nobody pattern-matched for.');
    // But the command line still never appears.
    expect(message).not.toContain('--disable-a');
  });
});
