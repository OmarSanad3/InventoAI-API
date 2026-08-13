import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';
import {
  FAQ_ANSWER_MAX_LENGTH,
  FAQ_ANSWER_MIN_LENGTH,
  FAQ_QUESTION_MAX_LENGTH,
  FAQ_QUESTION_MIN_LENGTH,
} from '../faq.constants';

/**
 * Every field optional; an omitted one is left alone. Hand-written rather than
 * `PartialType(CreateFaqDto)` for the same reason as the catalog DTOs —
 * `@nestjs/mapped-types` is not a dependency.
 *
 * `position` is not here: ordering moves through `PATCH /faqs/reorder`, which
 * validates the whole list at once.
 */
export class UpdateFaqDto {
  @IsOptional()
  @IsString()
  @Length(FAQ_QUESTION_MIN_LENGTH, FAQ_QUESTION_MAX_LENGTH)
  question?: string;

  @IsOptional()
  @IsString()
  @Length(FAQ_ANSWER_MIN_LENGTH, FAQ_ANSWER_MAX_LENGTH)
  answer?: string;

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;
}
