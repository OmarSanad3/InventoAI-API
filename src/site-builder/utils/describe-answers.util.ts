import {
  findQuestion,
  OnboardingQuestion,
} from '../constants/onboarding-questions';
import { AnswerValue, QuestionAnswer } from '../types/question-answer';

/**
 * Renders the questionnaire as readable lines for a prompt, resolving option
 * indexes back to their labels and dropping anything left blank.
 */
export function describeAnswers(answers: readonly QuestionAnswer[]): string {
  return answers
    .map((entry) => describeAnswer(entry))
    .filter((line): line is string => line !== null)
    .join('\n');
}

function describeAnswer({ questionId, answer }: QuestionAnswer): string | null {
  const question = findQuestion(questionId);
  if (!question) {
    return null;
  }
  const value = formatAnswer(question, answer);
  return value ? `- ${question.label} ${value}` : null;
}

function formatAnswer(
  question: OnboardingQuestion,
  answer: AnswerValue,
): string | null {
  if (answer === null) {
    return null;
  }
  if (question.type === 'text') {
    return typeof answer === 'string' ? answer : null;
  }

  const options = question.options ?? [];
  if (question.type === 'single') {
    return typeof answer === 'number' ? (options[answer] ?? null) : null;
  }
  if (!Array.isArray(answer)) {
    return null;
  }
  const labels = answer
    .map((index) => options[index])
    .filter((label): label is string => Boolean(label));
  return labels.length > 0 ? labels.join(', ') : null;
}
