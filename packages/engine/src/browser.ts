// Launches Chromium. Order: CHROMIUM_PATH env → browsers installed by `npx playwright install chromium`
// → the npm-packaged @sparticuz/chromium build (works in sandboxes that can only reach npm).
import { chromium, type Browser } from 'playwright-core';

export async function launchBrowser(): Promise<Browser> {
  const headless = process.env.HEADFUL !== '1';
  if (process.env.CHROMIUM_PATH) return chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless });
  try {
    return await chromium.launch({ headless });
  } catch (first) {
    try {
      const mod = (await import('@sparticuz/chromium')) as unknown as { default: { executablePath(): Promise<string>; args: string[] } };
      const sp = mod.default;
      // --single-process (meant for Lambda) kills the browser when any context closes; the engine opens many.
      const args = sp.args.filter((a) => a !== '--single-process');
      return await chromium.launch({ executablePath: await sp.executablePath(), args, headless: true });
    } catch {
      throw new Error(`No Chromium found. Run "npx playwright install chromium" or set CHROMIUM_PATH.\n${(first as Error).message}`);
    }
  }
}
