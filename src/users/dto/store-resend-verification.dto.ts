import { IsNotEmpty, IsString } from 'class-validator';
import { IsSlug } from '../../common/validators/is-slug.decorator';
import { ResendVerificationDto } from './resend-verification.dto';

/** Request for a new verification code from a store's user. */
export class StoreResendVerificationDto extends ResendVerificationDto {
  @IsString()
  @IsNotEmpty()
  @IsSlug()
  storeSlug!: string;
}
