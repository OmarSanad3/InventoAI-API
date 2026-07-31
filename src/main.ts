import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { EnvironmentVariables } from './config/env.validation';

const CORS_MAX_AGE_SECONDS = 86400;

/** Splits the comma-separated `CORS_ORIGINS` env var into a clean origin list. */
function parseCorsOrigins(rawOrigins: string): string[] {
  return rawOrigins
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter((origin) => origin.length > 0);
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService =
    app.get<ConfigService<EnvironmentVariables, true>>(ConfigService);

  app.enableCors({
    origin: parseCorsOrigins(
      configService.get('CORS_ORIGINS', { infer: true }),
    ),
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
    maxAge: CORS_MAX_AGE_SECONDS,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.listen(configService.get('PORT', { infer: true }));
}
void bootstrap();
