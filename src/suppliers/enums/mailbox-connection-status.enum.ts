/**
 * Whether a store's mailbox grant is usable.
 *
 * Two of these three are failure states, and they are separate because their
 * causes are: `revoked` is Google's answer (the owner withdrew access, changed
 * their password, or — in *testing* publishing status — let the 7-day refresh
 * token lapse), while `expired` is **ours** (a stored token this deployment can
 * no longer decrypt, which is what a rotated encryption key looks like).
 *
 * The behaviour is identical for both — stop polling, ask the owner to
 * reconnect — but the dashboard sentence is not, and an owner told "reconnect
 * Gmail" for a key rotation on our side deserves not to go looking through their
 * Google security settings for a revocation that never happened.
 */
export enum MailboxConnectionStatus {
  Connected = 'connected',
  Expired = 'expired',
  Revoked = 'revoked',
}
