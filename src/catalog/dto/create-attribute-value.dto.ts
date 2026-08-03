import { IsOptional, IsString, Length, Matches } from 'class-validator';
import { IsSlug } from '../../common/validators/is-slug.decorator';
import {
  ATTRIBUTE_VALUE_MAX_LENGTH,
  ATTRIBUTE_VALUE_MIN_LENGTH,
  ATTRIBUTE_VALUE_SLUG_MAX_LENGTH,
  ATTRIBUTE_VALUE_SLUG_MIN_LENGTH,
  SWATCH_HEX_PATTERN,
} from '../catalog.constants';

/** One entry of an attribute's controlled vocabulary. */
export class CreateAttributeValueDto {
  @IsString()
  @Length(ATTRIBUTE_VALUE_MIN_LENGTH, ATTRIBUTE_VALUE_MAX_LENGTH)
  value!: string;

  /** Omitted means "derive it from the value". */
  @IsOptional()
  @IsSlug()
  @Length(ATTRIBUTE_VALUE_SLUG_MIN_LENGTH, ATTRIBUTE_VALUE_SLUG_MAX_LENGTH)
  slug?: string;

  /** Required when the attribute's style is `swatch`, rejected otherwise. */
  @IsOptional()
  @Matches(SWATCH_HEX_PATTERN, {
    message: 'swatchHex must be a #RRGGBB colour',
  })
  swatchHex?: string;
}
