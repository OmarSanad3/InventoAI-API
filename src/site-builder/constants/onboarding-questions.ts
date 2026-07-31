export type QuestionType = 'text' | 'single' | 'multi';

export interface OnboardingQuestion {
  readonly id: string;
  readonly label: string;
  readonly type: QuestionType;
  readonly options?: readonly string[];
  readonly required: boolean;
  /** Present when the question is conditional on something in the draft. */
  readonly showWhen?: 'logoUploaded';
}

/**
 * The questionnaire the AI pre-fills and the owner edits. Versioned with the
 * code rather than stored in a table: the Gemini prompt and response schema are
 * both built from this list, so the two can never drift apart.
 */
export const ONBOARDING_QUESTIONS: readonly OnboardingQuestion[] = [
  {
    id: 'q1',
    label: "What's your business name?",
    type: 'text',
    required: true,
  },
  {
    id: 'q2',
    label: 'What does your business sell?',
    type: 'text',
    required: true,
  },
  {
    id: 'q3',
    label: 'Who is your target audience?',
    type: 'text',
    required: true,
  },
  {
    id: 'q4',
    label: "What's your price range?",
    type: 'multi',
    options: ['Budget', 'Mid-range', 'Premium', 'Luxury'],
    required: true,
  },
  {
    id: 'q5',
    label: "How would you describe your brand's personality?",
    type: 'single',
    options: ['Energetic', 'Calm', 'Elegant', 'Playful'],
    required: true,
  },
  {
    id: 'q6',
    label: 'What type of products do you sell?',
    type: 'single',
    options: ['Physical', 'Digital', 'Both'],
    required: true,
  },
  {
    id: 'q7',
    label: 'Your preferred color?',
    type: 'single',
    options: [
      'Blue',
      'Red',
      'Green',
      'Yellow',
      'Purple',
      'Orange',
      'Pink',
      'Neutral',
      'Let AI choose',
    ],
    required: false,
    showWhen: 'logoUploaded',
  },
] as const;

/** The question whose answer becomes the store name. */
export const BUSINESS_NAME_QUESTION_ID = 'q1';

export function findQuestion(
  questionId: string,
): OnboardingQuestion | undefined {
  return ONBOARDING_QUESTIONS.find((question) => question.id === questionId);
}

/** Drops the conditional questions that don't apply to the current draft. */
export function getVisibleQuestions(
  hasLogo: boolean,
): readonly OnboardingQuestion[] {
  if (hasLogo) {
    return ONBOARDING_QUESTIONS;
  }
  return ONBOARDING_QUESTIONS.filter(
    (question) => question.showWhen !== 'logoUploaded',
  );
}
