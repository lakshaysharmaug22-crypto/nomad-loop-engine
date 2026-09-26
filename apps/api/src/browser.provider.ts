// One shared Chromium for all jobs (each job opens its own isolated contexts), launched lazily.
import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { launchBrowser } from '@nomad/engine';
import type { Browser } from 'playwright-core';

@Injectable()
export class BrowserProvider implements OnApplicationShutdown {
  private readonly log = new Logger(BrowserProvider.name);
  private browser: Promise<Browser> | null = null;

  get(): Promise<Browser> {
    if (!this.browser) {
      this.browser = launchBrowser().then((b) => {
        b.on('disconnected', () => {
          this.log.warn('Chromium disconnected; it will be relaunched on the next job');
          this.browser = null;
        });
        return b;
      });
      this.browser.catch(() => (this.browser = null));
    }
    return this.browser;
  }

  async onApplicationShutdown() {
    if (this.browser) await (await this.browser).close().catch(() => {});
  }
}
