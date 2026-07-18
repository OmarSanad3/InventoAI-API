import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { EnvironmentVariables } from './config/env.validation';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService =
    app.get<ConfigService<EnvironmentVariables, true>>(ConfigService);
  await app.listen(configService.get('PORT', { infer: true }));
}
void bootstrap();
