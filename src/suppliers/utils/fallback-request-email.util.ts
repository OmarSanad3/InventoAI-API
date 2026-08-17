/** Everything a request email has to say, whoever ends up writing it. */
export interface RequestEmailFacts {
  readonly storeName: string;
  readonly productTitle: string;
  /** `"Size: M, Colour: Navy"`, or `null` for a product sold one way. */
  readonly variantLabel: string | null;
  readonly quantity: number;
  /** `null` when the owner set no deadline — then the mail asks, not tells. */
  readonly neededWithinDays: number | null;
  /** The owner's own steer, appended verbatim. */
  readonly note: string | null;
}

/** A subject and a body, which is all either writer of this email produces. */
export interface RequestEmailDraft {
  readonly subject: string;
  readonly body: string;
}

/**
 * The email a purchase request sends when Gemini cannot write one.
 *
 * The same rule `buildFallbackSentence` follows in the Advisor: the template
 * says everything the mail must say, so an outage costs an owner some warmth of
 * phrasing and never the ability to send. It asks the three questions the
 * extraction step later looks for — price, availability, delivery time — which
 * is not a coincidence: a reply to a mail that never asked for a delivery time
 * cannot be ranked on one.
 *
 * **There is no greeting here.** One request goes to several suppliers from one
 * body the owner edited once, so "Dear Nile Textiles," is added per recipient by
 * the mail template rather than baked into the text.
 */
export function buildFallbackRequestEmail({
  storeName,
  productTitle,
  variantLabel,
  quantity,
  neededWithinDays,
  note,
}: RequestEmailFacts): RequestEmailDraft {
  const item = describeItem(productTitle, variantLabel);
  const deadline =
    neededWithinDays === null
      ? ''
      : ` We would need it delivered within ${neededWithinDays} days.`;
  const extra = note ? `\n\n${note.trim()}` : '';

  return {
    subject: `Purchase request from ${storeName} — ${item}`,
    body: `We would like to order ${quantity} units of ${item}.${deadline}

Could you please confirm:
1. Your unit price
2. Whether ${quantity} units are available
3. How many days delivery would take${extra}

Thank you,
${storeName}`,
  };
}

/**
 * Puts the store's sign-off on the end of a drafted body, on its own lines.
 *
 * The model is told not to write one, and this is why: asked for a sign-off it
 * returns `"… within 10 days. Layali Abayas"` — the store's name welded to the
 * last sentence, because a lite model writing into a JSON string is careless
 * with newlines. A sign-off is not wording, it is a fact about who is writing,
 * so it belongs in code with the rest of them.
 *
 * A closing the model wrote anyway is stripped rather than duplicated.
 */
export function appendSignOff(body: string, storeName: string): string {
  let text = body.trimEnd();

  if (text.toLowerCase().endsWith(storeName.toLowerCase())) {
    text = text.slice(0, -storeName.length).trimEnd();
  }
  text = text
    .replace(
      /(?:thank you|thanks|kind regards|best regards|regards|sincerely)[,.!]?$/i,
      '',
    )
    .trimEnd();

  return `${text}\n\nThank you,\n${storeName}`;
}

/** "Linen Summer Abaya (Size: M)" — the shelf, named the way an owner reads it. */
export function describeItem(
  productTitle: string,
  variantLabel: string | null,
): string {
  return variantLabel ? `${productTitle} (${variantLabel})` : productTitle;
}
