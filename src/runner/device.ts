import { devices } from 'playwright';

/**
 * A device a test runs as, named from Playwright's registry (design
 * a-test-names-its-device, D1). One name sets the viewport, the screen, the user
 * agent, the device scale factor, `isMobile` and `hasTouch` together, the six
 * things a responsive app reacts to.
 */

/** Whether `name` is in the installed Playwright's registry. */
export function isDevice(name: string): boolean {
  return Object.hasOwn(devices, name);
}

/**
 * The message for a name not in the registry (design D2): the last three names
 * containing every word of the given one, case-insensitively, which are the
 * newest the registry lists, or a pointer to Playwright's list.
 */
export function unknownDeviceMessage(name: string): string {
  const words = name.toLowerCase().split(/\s+/).filter(Boolean);
  // A name wrong only in its case is the one meant.
  const same = Object.keys(devices).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  if (same) return `"${name}" is not a device Playwright knows; did you mean "${same}"? Names are case-sensitive`;
  const close = Object.keys(devices)
    .filter((candidate) => !candidate.endsWith(' landscape'))
    .filter((candidate) => words.length > 0 && words.every((word) => candidate.toLowerCase().includes(word)))
    .slice(-3);
  const hint = close.length
    ? `did you mean ${close.map((c) => `"${c}"`).join(', ')}?`
    : 'see the device names in Playwright\'s registry: https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/deviceDescriptorsSource.json';
  return `"${name}" is not a device Playwright knows; ${hint}`;
}

/**
 * The browser context options for a device, or none without one. The
 * descriptor's `defaultBrowserType` is dropped: every test runs in Chromium, and
 * it is not a context option (design D1).
 */
export function deviceOptions(name: string | undefined): Record<string, unknown> {
  if (!name) return {};
  const { defaultBrowserType: _browser, ...options } = devices[name]!;
  return options;
}
