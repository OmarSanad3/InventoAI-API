import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client, type TokenPayload } from 'google-auth-library';
import { EnvironmentVariables } from '../config/env.validation';
import {
  GOOGLE_ISSUERS,
  GOOGLE_SIGN_IN_FAILED_MESSAGE,
  GOOGLE_UNAVAILABLE_MESSAGE,
  TRANSPORT_ERROR_CODES,
} from './auth.constants';

/** The verified claims of a Google ID token. Never built from an unchecked one. */
export interface GoogleIdentity {
  /** Google's `sub`: stable and immutable, unlike the address beside it. */
  readonly googleId: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly picture: string | null;
}

/**
 * Turns a Google ID token into a verified claim about who is calling — the same
 * kind of thing `TokenService` does for our own tokens, and it touches no table.
 *
 * A `jwt.decode()` here would be a security hole with a friendly name: anyone
 * can mint that JSON. `verifyIdToken` checks the RS256 signature against
 * Google's rotating JWKS (which the client caches), the issuer, the expiry and
 * — the one people forget — that `aud` is *our* client id.
 */
@Injectable()
export class GoogleTokenVerifier {
  private readonly logger = new Logger(GoogleTokenVerifier.name);
  private readonly client: OAuth2Client;
  private readonly clientId: string;

  constructor(
    private readonly configService: ConfigService<EnvironmentVariables, true>,
  ) {
    this.clientId = this.configService.get('GOOGLE_CLIENT_ID', { infer: true });
    this.client = new OAuth2Client(this.clientId);
  }

  /** Verified claims, or throws. Never returns an unverified payload. */
  async verify(idToken: string): Promise<GoogleIdentity> {
    const payload = await this.verifyPayload(idToken);
    if (!payload.sub || !payload.email) {
      throw new UnauthorizedException(GOOGLE_SIGN_IN_FAILED_MESSAGE);
    }

    return {
      googleId: payload.sub,
      email: payload.email,
      emailVerified: payload.email_verified === true,
      firstName: payload.given_name ?? null,
      lastName: payload.family_name ?? null,
      picture: payload.picture ?? null,
    };
  }

  private async verifyPayload(idToken: string): Promise<TokenPayload> {
    try {
      const ticket = await this.client.verifyIdToken({
        idToken,
        audience: this.clientId,
      });
      const payload = ticket.getPayload();
      if (!payload || !GOOGLE_ISSUERS.includes(payload.iss)) {
        throw new UnauthorizedException(GOOGLE_SIGN_IN_FAILED_MESSAGE);
      }
      return payload;
    } catch (err) {
      // A token we could not check and a Google we could not reach are
      // different answers: the first is the caller's fault, the second is ours.
      if (isTransportFailure(err)) {
        this.logger.error(
          `Could not reach Google to verify an ID token: ${describe(err)}`,
        );
        throw new ServiceUnavailableException(GOOGLE_UNAVAILABLE_MESSAGE);
      }
      if (err instanceof UnauthorizedException) {
        throw err;
      }
      this.logger.warn(`Rejected a Google ID token: ${describe(err)}`);
      throw new UnauthorizedException(GOOGLE_SIGN_IN_FAILED_MESSAGE);
    }
  }
}

/**
 * A failed JWKS fetch rather than a bad token. `google-auth-library` throws
 * plain errors for both, so this reads the transport's own markers: a Node
 * socket error code, or a 5xx from Google's certificate endpoint.
 */
function isTransportFailure(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) {
    return false;
  }
  const candidate = err as { code?: unknown; response?: { status?: unknown } };
  if (
    typeof candidate.code === 'string' &&
    TRANSPORT_ERROR_CODES.includes(candidate.code)
  ) {
    return true;
  }
  const status = candidate.response?.status;
  return typeof status === 'number' && status >= 500;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
