/**
 * Whether an inbound message has already been read into an offer.
 *
 * This is the rule that makes `SupplierReplyService.ingest` safe for a machine to
 * call, and it is a tested function rather than three lines inside the service
 * for the reason `sanitizeExtractedOffer` is: it guards the numbers an owner
 * spends money from, and every way it can be wrong is a way those numbers go
 * stale or backwards.
 *
 * A **paste carries no message id and is never skipped** — a person pasting a
 * reply has decided it should be read, and second-guessing them would make the
 * fallback route feel broken.
 */

/** Just the fields the rule reads — no entity, so no database to test against. */
export interface DedupeState {
  readonly mailboxMessageId: string | null;
  readonly repliedAt: Date | null;
}

export interface InboundIdentity {
  readonly providerMessageId: string | null;
  readonly receivedAt: Date | null;
}

export function isReplyAlreadyRead(
  offer: DedupeState,
  { providerMessageId, receivedAt }: InboundIdentity,
): boolean {
  if (!providerMessageId) {
    return false;
  }

  // The same message delivered twice: a re-delivered history page, or a retry.
  if (offer.mailboxMessageId === providerMessageId) {
    return true;
  }

  // An *older* message arriving after a newer one — which is exactly what an
  // expired watermark produces, because the fallback re-reads every thread from
  // its first message. Without this, a re-read walks a supplier's original quote
  // back over their revised one, and over any correction the owner typed in
  // between. Equal timestamps count as already-read: two messages in the same
  // second are indistinguishable by this rule, and the safe reading is to keep
  // what is stored.
  return (
    receivedAt !== null &&
    offer.repliedAt !== null &&
    receivedAt.getTime() <= offer.repliedAt.getTime()
  );
}
