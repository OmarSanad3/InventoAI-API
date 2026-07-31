import { IsNotEmpty, IsString } from 'class-validator';
import { IsSlug } from '../../common/validators/is-slug.decorator';
import { RegisterUserDto } from './register-user.dto';

/**
 * Registration into an existing store. `RegisterUserDto` stays the platform
 * (owner) shape, so `forbidNonWhitelisted` rejects a `storeSlug` sent to the
 * owner route on its own.
 */
export class RegisterStoreUserDto extends RegisterUserDto {
  @IsString()
  @IsNotEmpty()
  @IsSlug()
  storeSlug!: string;
}
