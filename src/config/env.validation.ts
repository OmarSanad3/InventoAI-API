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

  /** The chat model, separate from `GEMINI_MODEL`: chat wants cheap and fast. */
  @IsString()
  CHATBOT_MODEL!: string;

  @IsNumber()
  CHATBOT_MAX_MESSAGES_PER_SESSION!: number;

  @IsNumber()
  CHATBOT_RATE_LIMIT_PER_MINUTE!: number;

  /** Turns of transcript sent back to the model with each new message. */
  @IsNumber()
  CHATBOT_HISTORY_TURNS!: number;

  /**
   * Open-Meteo's base URL. An env var rather than a constant because it is an
   * external host: a test points it at a stub, and a self-hosted instance is a
   * deployment decision.
   */
  @IsUrl({ require_tld: false })
  ADVISOR_WEATHER_BASE_URL!: string;

  /**
   * The zone a store that has not chosen one is scheduled in. It says where the
   * platform is deployed, not what the code believes about calendars.
   */
  @IsString()
  ADVISOR_DEFAULT_TIMEZONE!: string;

  /**
   * The model that writes the brief's prose, separate from `GEMINI_MODEL` for
   * the reason `CHATBOT_MODEL` is: the free tier allows ~20 calls per day on a
   * full flash model, and the site builder spends them. The Advisor's prose is
   * a rewrite of sentences it was handed, so a lite model does it well.
   */
  @IsString()
  ADVISOR_MODEL!: string;

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
