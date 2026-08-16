import { ChatResolution } from '../enums/chat-resolution.enum';
import { ChatTurnSources } from '../types/chat-turn';

/**
 * What one exchange is recorded as, decided from what the tools actually did.
 *
 * In order of precedence:
 *
 * 1. Something broke, so nothing else about the turn is trustworthy.
 * 2. The sign-in tool ran — an order question from a session with nobody signed
 *    in.
 * 3. A tool returned something.
 * 4. Tools ran and found nothing: on topic, retrieved nothing. **This is the
 *    Advisor's feed**, so it has to be distinguishable from the case below.
 * 5. No tool was reached for at all, which is what off-topic looks like: the
 *    model had nothing in this store to consult.
 *
 * Deliberately not asked of the model. One asked whether it was helpful says
 * yes, and an owner would then be told to stock things nobody asked for.
 */
export function resolveOutcome(
  sources: ChatTurnSources,
  hasFailed: boolean,
): ChatResolution {
  if (hasFailed) {
    return ChatResolution.Error;
  }
  if (sources.needsSignIn) {
    return ChatResolution.NeedsLogin;
  }
  if (sources.hitCount > 0) {
    return ChatResolution.Answered;
  }
  return sources.callCount > 0
    ? ChatResolution.Unanswered
    : ChatResolution.OffTopic;
}
