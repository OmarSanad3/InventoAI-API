import { IsOptional, IsString, Length } from 'class-validator';
import { MAX_GENERATION_INSTRUCTIONS_LENGTH } from '../catalog.constants';

/**
 * Everything the owner may steer a generation with — and deliberately nothing
 * else. The business itself comes from the questionnaire the server already
 * stores, so an admin cannot prompt-inject a different business, and the
 * frontend does not have to re-send what the backend knows.
 */
export class GenerateCatalogDto {
  /** e.g. "more categories for kids, we don't sell shoes". */
  @IsOptional()
  @IsString()
  @Length(1, MAX_GENERATION_INSTRUCTIONS_LENGTH)
  instructions?: string;
}
