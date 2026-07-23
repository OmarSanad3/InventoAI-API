import { IsNotEmpty, IsString, Matches, MinLength } from 'class-validator';
import { Match } from '../../common/validators/match.decorator';
import { PASSWORD_PATTERN } from './register-user.dto';

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  oldPassword!: string;

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
