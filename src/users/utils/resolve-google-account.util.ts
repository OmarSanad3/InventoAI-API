/** What a Google sign-in should do with the rows it found. */
export enum GoogleAccountAction {
  /** The identity is already on a row in this scope: issue tokens. */
  Login = 'login',
  /** A local row owns the address: attach the identity to it. */
  Link = 'link',
  /** Nobody owns either: make the account. */
  Create = 'create',
  /** Google will not vouch for the address: touch nothing. */
  Refuse = 'refuse',
}

export interface ResolveGoogleAccountInput<T> {
  /** The row in this scope whose `googleId` is the identity's `sub`, if any. */
  readonly existingByGoogleId: T | null;
  /** The row in this scope whose email is the identity's, if any. */
  readonly existingByEmail: T | null;
  /** Google's `email_verified` claim. */
  readonly isGoogleEmailVerified: boolean;
}

export type GoogleAccountResolution<T> =
  | { readonly action: GoogleAccountAction.Login; readonly user: T }
  | { readonly action: GoogleAccountAction.Link; readonly user: T }
  | { readonly action: GoogleAccountAction.Create }
  | { readonly action: GoogleAccountAction.Refuse };

/**
 * The linking rule, and the security core of Google sign-in.
 *
 * A `googleId` hit wins before anything else, including a changed address:
 * `sub` is immutable and an email is not, so a Workspace user who renamed their
 * mailbox is still the same person and still logs in.
 *
 * Linking a Google identity onto an existing local row is only safe because
 * Google asserted control of that mailbox — and control of the mailbox already
 * takes the account over through `forgot-password`, so the link grants nothing
 * new. On an *unverified* address it would grant everything, to anyone who can
 * make a Google account claiming it, which is why both remaining branches are
 * gated on the claim.
 */
export function resolveGoogleAccount<T>({
  existingByGoogleId,
  existingByEmail,
  isGoogleEmailVerified,
}: ResolveGoogleAccountInput<T>): GoogleAccountResolution<T> {
  if (existingByGoogleId) {
    return { action: GoogleAccountAction.Login, user: existingByGoogleId };
  }

  if (!isGoogleEmailVerified) {
    return { action: GoogleAccountAction.Refuse };
  }

  if (existingByEmail) {
    return { action: GoogleAccountAction.Link, user: existingByEmail };
  }

  return { action: GoogleAccountAction.Create };
}
