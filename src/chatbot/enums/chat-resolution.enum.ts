/**
 * What became of one exchange.
 *
 * **Computed in code, never reported by the model.** It is derived from what the
 * tools actually returned, because a model asked to assess itself says it was
 * helpful — and `Unanswered` is the column the Daily AI Advisor mines to tell an
 * owner what to stock. It has to be true.
 */
export enum ChatResolution {
  /** A tool returned something and the reply was built on it. */
  Answered = 'answered',

  /** On topic, retrieved nothing. **This is the Advisor's feed.** */
  Unanswered = 'unanswered',

  /** Not about this store; the one-line redirect. */
  OffTopic = 'off_topic',

  /** An order question from a session with no signed-in customer. */
  NeedsLogin = 'needs_login',

  /** The model or a tool failed; the shopper got the fallback sentence. */
  Error = 'error',
}
