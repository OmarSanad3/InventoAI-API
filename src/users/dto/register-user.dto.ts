import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Match } from '../../common/validators/match.decorator';

export const PASSWORD_PATTERN = /^(?=.*[A-Za-z])(?=.*\d).+$/;

export class RegisterUserDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lastName!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  @Matches(PASSWORD_PATTERN, {
    message: 'password must contain at least one letter and one number',
  })
  password!: string;

  @IsString()
  @Match('password')
  confirmPassword!: string;

  @IsOptional()
  @IsString()
  image?: string;
}
