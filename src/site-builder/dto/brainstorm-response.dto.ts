import { QuestionAnswer } from '../types/question-answer';

/**
 * The pre-filled questionnaire. Every visible question is present, with a `null`
 * answer where nothing could be inferred, so the client can render an empty
 * control without guessing.
 */
export class BrainstormResponseDto {
  questions!: QuestionAnswer[];

  static fromAnswers(answers: QuestionAnswer[]): BrainstormResponseDto {
    const dto = new BrainstormResponseDto();
    dto.questions = answers;
    return dto;
  }
}
