import { IsOptional, IsString, Length, Matches } from 'class-validator';
import { IsSlug } from '../../common/validators/is-slug.decorator';
import {
  ATTRIBUTE_VALUE_MAX_LENGTH,
  ATTRIBUTE_VALUE_MIN_LENGTH,
  ATTRIBUTE_VALUE_SLUG_MAX_LENGTH,
  ATTRIBUTE_VALUE_SLUG_MIN_LENGTH,
  SWATCH_HEX_PATTERN,
} from '../catalog.constants';

/**
 * Every field optional; an omitted one is left alone. Renaming `value` is free
 * and every product follows immediately, because products reference the value
 * by id. Changing `slug` moves a customer-visible address, so it takes an
 * explicit field — exactly as categories decided.
 */
export class UpdateAttributeValueDto {
  @IsOptional()
  @IsString()
  @Length(ATTRIBUTE_VALUE_MIN_LENGTH, ATTRIBUTE_VALUE_MAX_LENGTH)
  value?: string;

  @IsOptional()
  @IsSlug()
  @Length(ATTRIBUTE_VALUE_SLUG_MIN_LENGTH, ATTRIBUTE_VALUE_SLUG_MAX_LENGTH)
  slug?: string;

  @IsOptional()
  @Matches(SWATCH_HEX_PATTERN, {
    message: 'swatchHex must be a #RRGGBB colour',
  })
  swatchHex?: string;
}
