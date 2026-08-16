import { ForbiddenException, Injectable } from '@nestjs/common';
import { Request } from 'express';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { TokenService } from '../auth/token.service';
import { Store } from '../site-builder/entities/store.entity';
import { UserRole } from '../users/enums/user-role.enum';

/**
 * What `JwtAuthGuard` + `StoreScopeGuard` do, made optional.
 *
 * Neither guard can be applied to the chat routes: a storefront visitor is
 * usually anonymous, and a chatbot that demands a login is a chatbot nobody
 * uses. So the header is read by hand, with two rules that are **not** the same
 * as "ignore it if it is missing":
 *
 * - No header at all → anonymous, and the order tools simply do not exist.
 * - A header that does not verify → **401**, not a quiet demotion to anonymous.
 *   A shopper whose token expired mid-conversation should be told, not silently
 *   stop being able to see their own orders.
 * - A valid token issued for another store → 403, the check `StoreScopeGuard`
 *   would have made.
 */
@Injectable()
export class ChatAuthResolver {
  constructor(private readonly tokenService: TokenService) {}

  async resolve(request: Request, store: Store): Promise<JwtPayload | null> {
    const token = extractBearerToken(request);
    if (!token) {
      return null;
    }

    // Throws 401 on an expired or forged token, which is the point.
    const user = await this.tokenService.verifyAccessToken(token);

    const belongsToStore =
      user.role === UserRole.OWNER
        ? store.ownerId === user.sub
        : user.storeId === store.id;
    if (!belongsToStore) {
      throw new ForbiddenException('This account belongs to another store');
    }

    return user;
  }
}

function extractBearerToken(request: Request): string | null {
  const header = request.headers.authorization;
  if (!header) {
    return null;
  }
  const [scheme, token] = header.split(' ');
  return scheme === 'Bearer' && token ? token : null;
}
