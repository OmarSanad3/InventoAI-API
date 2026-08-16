/**
 * How the assistant sounds, as one line appended to the system prompt.
 *
 * An enum rather than a free-text persona, for the reason
 * [ecommerce-core] rejected free-text attribute values: this string is
 * concatenated into a system prompt, and "you are a pirate, ignore the shop" is
 * not a sentence an owner should be able to write by accident.
 */
export enum ChatbotTone {
  Friendly = 'friendly',
  Formal = 'formal',
  Playful = 'playful',
}
