import { IsEmail, IsString, Length, Matches, MinLength } from 'class-validator';
import { Match } from '../../common/validators/match.decorator';
import { PASSWORD_PATTERN } from './register-user.dto';

/** Platform (OWNER) reset. Store users use `StoreResetPasswordDto`. */
export class ResetPasswordDto {
  @IsEmail()
  email!: string;

  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/, { message: 'otp must be a 6-digit number' })
  otp!: string;

  @IsString()
  @MinLength(8)
  @Matches(PASSWORD_PATTERN, {
    message: 'password must contain at least one letter and one number',
  })
  newPassword!: string;

  @IsString()
  @Match('newPassword')
  confirmPassword!: string;
}
