import {
  ONBOARDING_QUESTIONS,
  OnboardingQuestion,
} from '../constants/onboarding-questions';

/** The catalog the client renders; `showWhen` tells it which ones are conditional. */
export class QuestionsResponseDto {
  questions!: readonly OnboardingQuestion[];

  static fromCatalog(): QuestionsResponseDto {
    const dto = new QuestionsResponseDto();
    dto.questions = ONBOARDING_QUESTIONS;
    return dto;
  }
}
