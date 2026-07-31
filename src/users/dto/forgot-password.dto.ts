import { IsEmail } from 'class-validator';

/** Platform (OWNER) reset request. Store users use `StoreForgotPasswordDto`. */
export class ForgotPasswordDto {
  @IsEmail()
  email!: string;
}
