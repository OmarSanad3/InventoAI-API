import { IsEmail, IsString, Length, Matches } from 'class-validator';

/** Platform (OWNER) verification. Store users use `StoreVerifyEmailDto`. */
export class VerifyEmailDto {
  @IsEmail()
  email!: string;

  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/, { message: 'otp must be a 6-digit number' })
  otp!: string;
}
