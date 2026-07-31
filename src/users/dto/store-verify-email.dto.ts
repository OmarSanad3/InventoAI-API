import { IsNotEmpty, IsString } from 'class-validator';
import { IsSlug } from '../../common/validators/is-slug.decorator';
import { VerifyEmailDto } from './verify-email.dto';

/**
 * Verification for a store's user. The slug is required — without it the code
 * would be looked up under the platform scope and always miss.
 */
export class StoreVerifyEmailDto extends VerifyEmailDto {
  @IsString()
  @IsNotEmpty()
  @IsSlug()
  storeSlug!: string;
}
