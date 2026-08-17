import { IsNotEmpty, IsString } from 'class-validator';
import { IsSlug } from '../../common/validators/is-slug.decorator';
import { GoogleLoginDto } from './google-login.dto';

/** Google sign-in against a store. The slug is required so it cannot be forgotten. */
export class GoogleStoreLoginDto extends GoogleLoginDto {
  @IsString()
  @IsNotEmpty()
  @IsSlug()
  storeSlug!: string;
}
