// Environment configuration, parsed and validated once at startup.
import { resolve } from 'node:path';
import { z } from 'zod';

const Env = z.object({
  PORT: z.coerce.number().int().default(8100),
  DATA_DIR: z.string().default('data'),
  /** ML service (ranker, embeddings, local LLM). Without it the engine runs rules-only with offline embeddings. */
  ML_URL: z.string().url().optional(),
  /** Postgres connection string. Without it, runs are indexed from the data directory. */
  DATABASE_URL: z.string().optional(),
  /** Redis connection string. Without it, runs execute on an in-process queue. */
  REDIS_URL: z.string().optional(),
  RUN_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
  CORS_ORIGIN: z.string().default('*'),
});

export type AppConfig = z.infer<typeof Env> & { dataDir: string; runsDir: string };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${issues}`);
  }
  const dataDir = resolve(parsed.data.DATA_DIR);
  return { ...parsed.data, dataDir, runsDir: resolve(dataDir, 'runs') };
}

export const CONFIG = Symbol('CONFIG');
