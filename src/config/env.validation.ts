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

  /**
   * The OAuth client id Google Sign-In tokens must be minted for. It is the
   * `aud` claim `GoogleTokenVerifier` checks, so a token issued for any other
   * app is rejected here. Named for the Cloud project rather than for the
   * route: the Gmail feature later shares this client and adds its own secret.
   */
  @IsString()
  GOOGLE_CLIENT_ID!: string;

  /**
   * The other half of the same Cloud client, needed only by the Gmail flow:
   * Google Sign-In verifies an ID token and holds no secret, while sending as the
   * owner is an authorization-code exchange and cannot be done without one.
   *
   * **May be empty**, like `GOOGLE_CLIENT_ID` is in a fresh checkout. An empty
   * value is not a misconfiguration — it is a deployment that does not offer
   * mailbox sending, and every route says so rather than throwing. That is why
   * this is `@IsString()` and not `@IsNotEmpty()`.
   */
  @IsString()
  GOOGLE_CLIENT_SECRET!: string;

  /**
   * Where Google returns the owner after they consent to the Gmail scopes — a
   * frontend screen, which then POSTs the code to `/mailbox/callback`.
   *
   * Separate from anything Google Sign-In uses because the two consents are
   * separate: identity is granted with no redirect at all, and this one must
   * match a URI registered in the Cloud console exactly.
   */
  @IsString()
  GOOGLE_MAILBOX_REDIRECT_URI!: string;

  /**
   * Gmail's API base. An env var rather than a constant for the reason
   * `ADVISOR_WEATHER_BASE_URL` is one: it is an external host, and a test points
   * it at a stub rather than at Google.
   */
  @IsUrl({ require_tld: false })
  GOOGLE_GMAIL_API_BASE_URL!: string;

  /**
   * 64 hex characters — a 32-byte AES-256 key — encrypting the stored mailbox
   * refresh tokens.
   *
   * This is the only secret in the project that protects property belonging to
   * somebody outside the company, so it is worth being blunt about what it does
   * and does not buy: a leaked database dump is not a leaked set of mailboxes,
   * because the key is not in Postgres. It buys nothing against an attacker
   * holding both, and **rotating it makes every stored grant unreadable** — those
   * connections report `expired` and the owners reconnect.
   *
   * Generate one with `openssl rand -hex 32`. May be empty, in which case the
   * server refuses to *ask* for a grant it could not store safely.
   */
  @IsString()
  MAILBOX_TOKEN_ENCRYPTION_KEY!: string;

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
