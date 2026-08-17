import {
  MAX_OFFER_DELIVERY_DAYS,
  MAX_OFFER_UNIT_PRICE,
  MAX_REQUEST_QUANTITY,
  MINOR_UNITS_PER_MAJOR,
  OFFER_NOTES_MAX_LENGTH,
} from '../suppliers.constants';

/** The fields an offer carries, once they have survived validation. */
export interface ExtractedOffer {
  /** **Minor units** — converted here, never by the model. */
  readonly unitAmount: number | null;
  readonly quantity: number | null;
  readonly deliveryDays: number | null;
  readonly notes: string | null;
}

/**
 * Turns what the model claims it read into what may be stored.
 *
 * **The unit conversion is the point of this function.** The model is asked for
 * a price in major units — it reads "249 EGP a piece" and returns `249` —
 * because a model asked for minor units returns `249` anyway, and an offer
 * stored at `249` instead of `24900` is a hundredfold error in the one table an
 * owner is about to spend money from. The unit is the code's business; the
 * reading is the model's.
 *
 * Every field is independently droppable. A reply that quoted a price and no
 * delivery time yields a price and a null, not a rejected extraction — the
 * offer is still rankable, and the owner can see what is missing.
 */
export function sanitizeExtractedOffer(raw: unknown): ExtractedOffer {
  const value = (raw ?? {}) as Record<string, unknown>;

  return {
    unitAmount: toUnitAmount(value.unitPrice),
    quantity: toBoundedInteger(value.quantity, 1, MAX_REQUEST_QUANTITY),
    deliveryDays: toBoundedInteger(
      value.deliveryDays,
      0,
      MAX_OFFER_DELIVERY_DAYS,
    ),
    notes: toNotes(value.notes),
  };
}

/** True when the extraction found something worth calling a reply. */
export function hasAnyField(offer: ExtractedOffer): boolean {
  return (
    offer.unitAmount !== null ||
    offer.quantity !== null ||
    offer.deliveryDays !== null
  );
}

/**
 * A price above `MAX_OFFER_UNIT_PRICE` is a misread rather than an expensive
 * product — a phone number, an order reference, or the line total taken for a
 * unit price. Dropping it leaves the owner an unpriced offer they can correct,
 * which is safer than a plausible wrong number in a comparison table.
 */
function toUnitAmount(raw: unknown): number | null {
  const price = toNumber(raw);
  if (price === null || price <= 0 || price > MAX_OFFER_UNIT_PRICE) {
    return null;
  }
  return Math.round(price * MINOR_UNITS_PER_MAJOR);
}

function toBoundedInteger(
  raw: unknown,
  min: number,
  max: number,
): number | null {
  const value = toNumber(raw);
  if (
    value === null ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    return null;
  }
  return value;
}

/** Accepts the string a model returns despite a numeric schema. */
function toNumber(raw: unknown): number | null {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : null;
  }
  if (typeof raw !== 'string') {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function toNotes(raw: unknown): string | null {
  if (typeof raw !== 'string') {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed.slice(0, OFFER_NOTES_MAX_LENGTH) : null;
}
