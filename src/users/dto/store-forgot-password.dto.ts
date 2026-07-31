import { IsNotEmpty, IsString } from 'class-validator';
import { IsSlug } from '../../common/validators/is-slug.decorator';
import { ForgotPasswordDto } from './forgot-password.dto';

/** Reset request for a store's user. */
export class StoreForgotPasswordDto extends ForgotPasswordDto {
  @IsString()
  @IsNotEmpty()
  @IsSlug()
  storeSlug!: string;
}
