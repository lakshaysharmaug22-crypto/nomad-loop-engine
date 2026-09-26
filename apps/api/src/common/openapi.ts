import type { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import { zodToJsonSchema } from 'zod-to-json-schema';

/** Turns a shared zod schema into an OpenAPI schema, so docs and validation cannot drift. */
export function openApiSchema(schema: unknown): SchemaObject {
  // zod-to-json-schema's generic signature is too deep for tsc here; the input is always a zod schema.
  const json = (zodToJsonSchema as (s: unknown, o: object) => Record<string, unknown>)(schema, { target: 'openApi3' });
  delete json.$schema;
  return json as SchemaObject;
}
