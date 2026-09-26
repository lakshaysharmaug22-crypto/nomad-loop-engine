import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { ZodSchema } from 'zod';

/** Validates and coerces a request body with a shared zod schema; errors list every failing field. */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    const r = this.schema.safeParse(value ?? {});
    if (r.success) return r.data;
    throw new BadRequestException({
      message: 'Validation failed',
      errors: r.error.issues.map((i) => ({ field: i.path.join('.') || '(body)', message: i.message })),
    });
  }
}
