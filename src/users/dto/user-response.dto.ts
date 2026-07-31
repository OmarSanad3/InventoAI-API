import { User } from '../entities/user.entity';
import { UserRole } from '../enums/user-role.enum';

export class UserResponseDto {
  id!: string;
  firstName!: string;
  lastName!: string;
  image!: string | null;
  email!: string;
  role!: UserRole;
  storeId!: string | null;
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
    dto.storeId = user.storeId;
    dto.isEmailVerified = user.isEmailVerified;
    dto.createdAt = user.createdAt;
    dto.updatedAt = user.updatedAt;
    return dto;
  }
}
