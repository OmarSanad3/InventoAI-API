import { IsNotEmpty, IsString } from 'class-validator';
import { IsSlug } from '../../common/validators/is-slug.decorator';
import { LoginDto } from './login.dto';

/** Login into a store. The slug is required so it can never be forgotten. */
export class StoreLoginDto extends LoginDto {
  @IsString()
  @IsNotEmpty()
  @IsSlug()
  storeSlug!: string;
}
