// Request schemas shared by the API (validation) and the web app (forms).
import { z } from 'zod';

const httpUrl = z
  .string()
  .trim()
  .url('Enter a full URL, like http://localhost:4100')
  .refine((u) => /^https?:\/\//i.test(u), 'Only http and https URLs can be explored');

export const StartRunInput = z.object({
  targetUrl: httpUrl,
  maxSteps: z.coerce.number().int().min(1).max(500).default(60),
  verifyRuns: z.coerce.number().int().min(1).max(5).default(3),
});
export type StartRunInput = z.infer<typeof StartRunInput>;

export const StartSweepInput = z.object({
  sourceRunId: z.string().min(1),
  targetUrl: httpUrl,
  label: z.string().trim().max(60).optional(),
});
export type StartSweepInput = z.infer<typeof StartSweepInput>;
