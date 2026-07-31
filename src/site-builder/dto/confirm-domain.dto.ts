import { IsNotEmpty, IsString, Length, MaxLength } from 'class-validator';
import { IsSlug } from '../../common/validators/is-slug.decorator';
import { SLUG_MAX_LENGTH, SLUG_MIN_LENGTH } from '../site-builder.constants';

const MAX_BUSINESS_NAME_LENGTH = 120;

export class ConfirmDomainDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_BUSINESS_NAME_LENGTH)
  businessName!: string;

  @IsString()
  @Length(SLUG_MIN_LENGTH, SLUG_MAX_LENGTH)
  @IsSlug()
  domain!: string;
}
