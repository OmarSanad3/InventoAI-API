import { IsOptional, IsString, Length, ValidateIf } from 'class-validator';
import { PRODUCT_IMAGE_ALT_TEXT_MAX_LENGTH } from '../catalog.constants';

/** Alt text is the only editable part of an image; the file itself is replaced. */
export class UpdateImageDto {
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @Length(0, PRODUCT_IMAGE_ALT_TEXT_MAX_LENGTH)
  altText?: string | null;
}
