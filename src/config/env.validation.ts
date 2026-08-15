import { plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsNumber,
  IsString,
  IsUrl,
  validateSync,
} from 'class-validator';

export enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

export class EnvironmentVariables {
  @IsEnum(Environment)
  NODE_ENV!: Environment;

  @IsNumber()
  PORT!: number;

  @IsString()
  DATABASE_HOST!: string;

  @IsNumber()
  DATABASE_PORT!: number;

  @IsString()
  DATABASE_USER!: string;

  @IsString()
  DATABASE_PASSWORD!: string;

  @IsString()
  DATABASE_NAME!: string;

  @IsString()
  REDIS_HOST!: string;

  @IsNumber()
  REDIS_PORT!: number;

  @IsString()
  JWT_ACCESS_SECRET!: string;

  @IsString()
  JWT_REFRESH_SECRET!: string;

  @IsString()
  JWT_ACCESS_EXPIRES_IN!: string;

  @IsString()
  JWT_REFRESH_EXPIRES_IN!: string;

  @IsNumber()
  OTP_EXPIRES_IN_SECONDS!: number;

  /** Minimum gap between two verification resends for one address. */
  @IsNumber()
  OTP_RESEND_COOLDOWN_SECONDS!: number;

  @IsString()
  MAIL_HOST!: string;

  @IsNumber()
  MAIL_PORT!: number;

  @IsString()
  MAIL_USER!: string;

  @IsString()
  MAIL_PASSWORD!: string;

  @IsString()
  MAIL_FROM!: string;

  /** Absolute URL — mail clients cannot fetch a relative or localhost asset. */
  @IsUrl({ require_tld: false })
  PLATFORM_LOGO_URL!: string;

  @IsString()
  SITE_BASE_URL!: string;

  @IsString()
  CORS_ORIGINS!: string;

  @IsString()
  GEMINI_API_KEY!: string;

  @IsString()
  GEMINI_MODEL!: string;

  /** Separate from `GEMINI_MODEL`: embeddings and generation version apart. */
  @IsString()
  GEMINI_EMBEDDING_MODEL!: string;

  /**
   * Must equal the `vector(n)` the knowledge base's initializer creates.
   * Changing it is a re-index, not a config tweak.
   */
  @IsNumber()
  EMBEDDING_DIMENSIONS!: number;

  @IsString()
  CLOUDINARY_CLOUD_NAME!: string;

  @IsString()
  CLOUDINARY_API_KEY!: string;

  @IsString()
  CLOUDINARY_API_SECRET!: string;

  @IsString()
  CLOUDINARY_FOLDER!: string;
}

export function validate(config: Record<string, unknown>) {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    throw new Error(errors.toString());
  }
  return validatedConfig;
}
