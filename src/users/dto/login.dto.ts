import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

/** Platform (OWNER) login. Store users log in with `StoreLoginDto`. */
export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;
}
