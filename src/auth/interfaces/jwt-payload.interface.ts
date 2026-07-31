import { UserRole } from '../../users/enums/user-role.enum';

export interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
  /** The store this session is scoped to; `null` for platform (OWNER) accounts. */
  storeId: string | null;
  jti?: string;
}
