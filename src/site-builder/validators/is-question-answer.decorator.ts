import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import {
  findQuestion,
  OnboardingQuestion,
} from '../constants/onboarding-questions';

export const MAX_TEXT_ANSWER_LENGTH = 500;

@ValidatorConstraint({ name: 'IsQuestionAnswer', async: false })
export class IsQuestionAnswerConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    const { questionId } = args.object as { questionId?: unknown };
    if (typeof questionId !== 'string') {
      return false;
    }

    const question = findQuestion(questionId);
    if (!question) {
      return false;
    }
    if (value === null || value === undefined) {
      return !question.required;
    }
    return this.hasValidShape(question, value);
  }

  defaultMessage(args: ValidationArguments): string {
    const { questionId } = args.object as { questionId?: unknown };
    return `answer for ${String(questionId)} is missing or does not match the question`;
  }

  private hasValidShape(question: OnboardingQuestion, value: unknown): boolean {
    if (question.type === 'text') {
      return (
        typeof value === 'string' &&
        value.trim().length > 0 &&
        value.length <= MAX_TEXT_ANSWER_LENGTH
      );
    }

    const optionCount = question.options?.length ?? 0;
    if (question.type === 'single') {
      return isOptionIndex(value, optionCount);
    }
    return (
      Array.isArray(value) &&
      value.length > 0 &&
      value.every((index) => isOptionIndex(index, optionCount))
    );
  }
}

function isOptionIndex(value: unknown, optionCount: number): boolean {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value < optionCount
  );
}

/**
 * Validates an answer against its own question in the onboarding catalog: the
 * expected type, and for choice questions that the index actually exists.
 */
export function IsQuestionAnswer(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (object: object, propertyName: string | symbol) => {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName as string,
      options: validationOptions,
      constraints: [],
      validator: IsQuestionAnswerConstraint,
    });
  };
}
