import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/** Shared by main.ts and the end-to-end tests so both serve the same app. */
export function configureApp(app: INestApplication) {
  app.enableShutdownHooks();
  const doc = new DocumentBuilder()
    .setTitle('Nomad Loop Engine API')
    .setDescription('Queue explorations and regression sweeps, read results, stream live events (Socket.IO namespace /live).')
    .setVersion('0.2.0')
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, doc), { jsonDocumentUrl: 'docs/openapi.json' });
  return app;
}
