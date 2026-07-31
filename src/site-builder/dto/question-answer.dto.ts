import { IsNotEmpty, IsString } from 'class-validator';
import type { AnswerValue, QuestionAnswer } from '../types/question-answer';
import { IsQuestionAnswer } from '../validators/is-question-answer.decorator';

export class QuestionAnswerDto implements QuestionAnswer {
  @IsString()
  @IsNotEmpty()
  questionId!: string;

  @IsQuestionAnswer()
  answer!: AnswerValue;
}
