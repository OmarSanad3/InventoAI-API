import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { GOOGLE_ID_TOKEN_MAX_LENGTH } from '../users.constants';

/**
 * Platform (OWNER) sign-in with Google. Store shoppers use
 * `GoogleStoreLoginDto`, which adds the slug — an omitted slug must never
 * silently mean "the platform".
 */
export class GoogleLoginDto {
  /**
   * The credential Google Identity Services handed the frontend. Verified
   * against Google's JWKS, never decoded — see `GoogleTokenVerifier`.
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(GOOGLE_ID_TOKEN_MAX_LENGTH)
  idToken!: string;
}
