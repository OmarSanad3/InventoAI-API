import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';
import {
  FAQ_ANSWER_MAX_LENGTH,
  FAQ_ANSWER_MIN_LENGTH,
  FAQ_QUESTION_MAX_LENGTH,
  FAQ_QUESTION_MIN_LENGTH,
} from '../faq.constants';

/**
 * There is deliberately no `storeId`: `forbidNonWhitelisted` then turns any
 * attempt to send one into a 400, and the store always comes from the JWT.
 *
 * `answer` is plain text. Markup is accepted as characters and stored as
 * characters — the storefront renders it as text, never as HTML.
 */
export class CreateFaqDto {
  @IsString()
  @Length(FAQ_QUESTION_MIN_LENGTH, FAQ_QUESTION_MAX_LENGTH)
  question!: string;

  @IsString()
  @Length(FAQ_ANSWER_MIN_LENGTH, FAQ_ANSWER_MAX_LENGTH)
  answer!: string;

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;
}
