import { SetMetadata } from '@nestjs/common';
import { UserRole } from '../../users/enums/user-role.enum';

export const ROLES_KEY = 'roles';

/**
 * Restricts a route to the given roles. Requires `JwtAuthGuard` to run first so
 * that `request.user` is populated, and `RolesGuard` to be applied after it.
 */
export function Roles(...roles: UserRole[]): MethodDecorator & ClassDecorator {
  return SetMetadata(ROLES_KEY, roles);
}
