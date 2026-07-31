import { Schema, Type } from '@google/genai';
import { OnboardingQuestion } from '../constants/onboarding-questions';

/**
 * Asks Gemini to fill the questionnaire from the owner's brainstorm. Answers are
 * keyed by question id so the response schema can type each one exactly:
 * a string for `text`, an option index for `single`, indexes for `multi`.
 */
export function buildPrefillAnswersPrompt(
  brainstorm: string,
  questions: readonly OnboardingQuestion[],
): string {
  return [
    'You are helping a small business owner set up an online store.',
    'Below is what the owner wrote about their business, followed by an onboarding questionnaire.',
    'Fill in every answer you can reasonably infer from their text.',
    'Use null for anything the text does not support — do not invent facts.',
    'For choice questions answer with the zero-based index of the option (or indexes for multiple choice).',
    '',
    'OWNER TEXT:',
    brainstorm,
    '',
    'QUESTIONS:',
    ...questions.map((question) => describeQuestion(question)),
  ].join('\n');
}

export function buildPrefillAnswersSchema(
  questions: readonly OnboardingQuestion[],
): Schema {
  return {
    type: Type.OBJECT,
    properties: Object.fromEntries(
      questions.map((question) => [question.id, buildAnswerSchema(question)]),
    ),
    required: questions.map((question) => question.id),
  };
}

function describeQuestion(question: OnboardingQuestion): string {
  const options = question.options
    ? ` Options: ${question.options.map((option, index) => `${index}=${option}`).join(', ')}.`
    : '';
  return `${question.id} (${question.type}): ${question.label}${options}`;
}

function buildAnswerSchema(question: OnboardingQuestion): Schema {
  if (question.type === 'text') {
    return { type: Type.STRING, nullable: true };
  }
  if (question.type === 'single') {
    return { type: Type.INTEGER, nullable: true };
  }
  return {
    type: Type.ARRAY,
    items: { type: Type.INTEGER },
    nullable: true,
  };
}
