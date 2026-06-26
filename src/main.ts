import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { AppConfigService } from './config/app-config.service';

async function bootstrap(): Promise<void> {
  // rawBody is required so the GitHub webhook signature can be verified over the exact bytes.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  app.useBodyParser('json', { limit: '10mb' });

  const config = app.get(AppConfigService);
  await app.listen(config.port);
  new Logger('Bootstrap').log(`AI PR Reviewer listening on port ${config.port}`);
}

void bootstrap();
