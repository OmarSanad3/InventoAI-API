import { IsEmail } from 'class-validator';

/**
 * Platform (OWNER) request for a new verification code. Store users use
 * `StoreResendVerificationDto`.
 */
export class ResendVerificationDto {
  @IsEmail()
  email!: string;
}
