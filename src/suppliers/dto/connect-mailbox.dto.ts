import { IsString, Length } from 'class-validator';

/** Google's codes and our state are both short; these are "someone is probing
 *  us" bounds, not format checks. */
const CODE_MAX_LENGTH = 1024;
const STATE_MAX_LENGTH = 256;

/**
 * The two values Google hands back to the frontend's redirect URI.
 *
 * The **code** is exchanged once, server-side, with the client secret — which is
 * why this is a POST from the frontend rather than a GET Google redirects
 * straight into: the secret never goes near a browser, and the callback page can
 * be an ordinary authenticated screen instead of a public route.
 *
 * The **state** is the CSRF guard, compared against the one this store started
 * its flow with. No `storeId`, as everywhere else: the store comes from the
 * token.
 */
export class ConnectMailboxDto {
  @IsString()
  @Length(1, CODE_MAX_LENGTH)
  code!: string;

  @IsString()
  @Length(1, STATE_MAX_LENGTH)
  state!: string;
}
