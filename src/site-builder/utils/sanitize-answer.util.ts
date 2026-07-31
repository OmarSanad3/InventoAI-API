import { OnboardingQuestion } from '../constants/onboarding-questions';
import { AnswerValue } from '../types/question-answer';
import { MAX_TEXT_ANSWER_LENGTH } from '../validators/is-question-answer.decorator';

/**
 * Coerces one AI-suggested answer into the wire format, returning `null` for
 * anything unusable. Unlike the request validator this never rejects — a bad
 * suggestion just comes back blank for the owner to fill in.
 */
export function sanitizeAnswer(
  question: OnboardingQuestion,
  value: unknown,
): AnswerValue {
  if (question.type === 'text') {
    return sanitizeText(value);
  }

  const optionCount = question.options?.length ?? 0;
  if (question.type === 'single') {
    return isOptionIndex(value, optionCount) ? (value as number) : null;
  }
  return sanitizeIndexes(value, optionCount);
}

function sanitizeText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const text = value.trim().slice(0, MAX_TEXT_ANSWER_LENGTH);
  return text.length > 0 ? text : null;
}

function sanitizeIndexes(value: unknown, optionCount: number): number[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const indexes = [
    ...new Set(value.filter((index) => isOptionIndex(index, optionCount))),
  ] as number[];
  return indexes.length > 0 ? indexes : null;
}

function isOptionIndex(value: unknown, optionCount: number): boolean {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value < optionCount
  );
}
