import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { Store } from '../../site-builder/entities/store.entity';
import { ChatbotSettings } from '../entities/chatbot-settings.entity';

/**
 * Everything one turn is scoped to, resolved from the URL slug and the optional
 * bearer token **before** the model runs.
 *
 * The tools close over this. Nothing in it is ever a tool parameter, so there is
 * no tenant id for the model to hallucinate and none for an instruction hidden
 * in a product description to overwrite.
 */
export interface ChatTurnContext {
  readonly store: Store;
  readonly slug: string;
  readonly user: JwtPayload | null;
  /** The owner's switches, resolved once per turn. Never persisted from here. */
  readonly settings: ChatbotSettings;
}

/**
 * What the tools found, accumulated across the turn.
 *
 * Mutable by design: `ToolNode` gives a tool no way to write graph state, so the
 * factory closes over this object and `finalize` reads it. It is per-request —
 * one turn, one object — so there is nothing shared to race on.
 */
export interface ChatTurnSources {
  productIds: string[];
  faqIds: string[];
  orderId: string | null;
  /** Kept beside the id because the payload is re-loaded by number, not by id. */
  orderNumber: number | null;
  /** How many tool calls returned something. `0` is what "unanswered" means. */
  hitCount: number;
  /** Whether any tool ran at all, hit or miss. */
  callCount: number;
  /**
   * The anonymous-only sign-in tool ran, so this was an order question from a
   * session with nobody signed in. A flag rather than a keyword check on the
   * message: the model routes, the code decides, and it works in any language.
   */
  needsSignIn: boolean;
}

export function createTurnSources(): ChatTurnSources {
  return {
    productIds: [],
    faqIds: [],
    orderId: null,
    orderNumber: null,
    hitCount: 0,
    callCount: 0,
    needsSignIn: false,
  };
}
