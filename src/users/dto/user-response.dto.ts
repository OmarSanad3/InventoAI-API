import { User } from '../entities/user.entity';
import { UserRole } from '../enums/user-role.enum';

export class UserResponseDto {
  id!: string;
  firstName!: string;
  lastName!: string;
  image!: string | null;
  email!: string;
  role!: UserRole;
  isEmailVerified!: boolean;
  createdAt!: Date;
  updatedAt!: Date;

  static fromEntity(user: User): UserResponseDto {
    const dto = new UserResponseDto();
    dto.id = user.id;
    dto.firstName = user.firstName;
    dto.lastName = user.lastName;
    dto.image = user.image;
    dto.email = user.email;
    dto.role = user.role;
    dto.isEmailVerified = user.isEmailVerified;
    dto.createdAt = user.createdAt;
    dto.updatedAt = user.updatedAt;
    return dto;
  }
}
