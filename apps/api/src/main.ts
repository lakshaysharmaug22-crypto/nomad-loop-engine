import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { loadConfig } from './config';

async function bootstrap() {
  const config = loadConfig();
  const app = await NestFactory.create(AppModule, { cors: { origin: config.CORS_ORIGIN === '*' ? true : config.CORS_ORIGIN.split(',') } });
  configureApp(app);
  await app.listen(config.PORT);
  const log = new Logger('Bootstrap');
  log.log(`listening on http://localhost:${config.PORT} (docs at /docs)`);
  log.log(`ML service: ${config.ML_URL ?? 'not configured, rules-only with offline embeddings'}`);
}

bootstrap().catch((e) => {
  console.error(e);
  process.exit(1);
});
