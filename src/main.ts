import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { SafeLogger } from './common/logging/safe-logger';
import { Settings } from './common/config/settings.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: new SafeLogger() });
  app.use(helmet());
  app.enableShutdownHooks();
  await app.listen(app.get(Settings).get('PORT'), '0.0.0.0');
}
void bootstrap().catch((error: unknown) => { new SafeLogger().error(error); process.exitCode = 1; });
