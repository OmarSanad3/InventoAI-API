import { IsNotEmpty, IsString } from 'class-validator';
import { IsSlug } from '../../common/validators/is-slug.decorator';
import { ResetPasswordDto } from './reset-password.dto';

/** Password reset for a store's user. */
export class StoreResetPasswordDto extends ResetPasswordDto {
  @IsString()
  @IsNotEmpty()
  @IsSlug()
  storeSlug!: string;
}
