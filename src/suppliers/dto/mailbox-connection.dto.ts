import { MailboxConnection } from '../entities/mailbox-connection.entity';
import { MailboxConnectionStatus } from '../enums/mailbox-connection-status.enum';

/**
 * What the dashboard may know about a connected mailbox.
 *
 * The refresh token is **not** here and cannot be: its column is `select: false`
 * and this factory never asks for it. That is deliberate belt and braces — the
 * one credential in this project belonging to somebody outside the company should
 * take two mistakes to leak, not one.
 *
 * `isSupported` is separate from `isConnected` because they fail differently. Not
 * supported means this deployment has no client secret and no encryption key, so
 * the dashboard should not offer a Connect button at all. Supported but not
 * connected is the button's whole purpose.
 */
export class MailboxConnectionDto {
  /** Whether this server can offer mailbox sending at all. */
  isSupported!: boolean;
  isConnected!: boolean;
  provider!: string | null;
  accountEmail!: string | null;
  status!: MailboxConnectionStatus | null;
  scopes!: string[];
  /** True while replies are being read automatically. */
  isSyncing!: boolean;
  lastSyncedAt!: Date | null;
  /** The sentence the dashboard shows when the owner needs to reconnect. */
  lastError!: string | null;
  connectedAt!: Date | null;

  static fromEntity(
    connection: MailboxConnection | null,
    { isSupported }: { isSupported: boolean },
  ): MailboxConnectionDto {
    const dto = new MailboxConnectionDto();
    dto.isSupported = isSupported;
    dto.isConnected = connection !== null;
    dto.provider = connection?.provider ?? null;
    dto.accountEmail = connection?.accountEmail ?? null;
    dto.status = connection?.status ?? null;
    dto.scopes = connection?.scopes ?? [];
    dto.isSyncing =
      connection?.status === MailboxConnectionStatus.Connected && isSupported;
    dto.lastSyncedAt = connection?.lastSyncedAt ?? null;
    dto.lastError = connection?.lastError ?? null;
    dto.connectedAt = connection?.connectedAt ?? null;
    return dto;
  }
}

/** Where to send the owner. A URL and the state it carries, nothing else. */
export class MailboxConsentDto {
  consentUrl!: string;
  state!: string;

  static of(input: { consentUrl: string; state: string }): MailboxConsentDto {
    const dto = new MailboxConsentDto();
    dto.consentUrl = input.consentUrl;
    dto.state = input.state;
    return dto;
  }
}
