import { UserResponseDto } from './user-response.dto';

export class RegisterResponseDto {
  message!: string;
  user!: UserResponseDto;
}
