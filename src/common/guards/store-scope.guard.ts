import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { StoreService } from '../../site-builder/store.service';
import { UserRole } from '../../users/enums/user-role.enum';

const SLUG_PARAMS = ['slug', 'storeSlug'] as const;

/**
 * Rejects a token issued for one store from being used on another store's
 * route. Runs after `JwtAuthGuard`, which populates `request.user`.
 *
 * An OWNER carries no `storeId` — they are checked against `Store.ownerId`
 * instead, which is where ownership actually lives.
 */
@Injectable()
export class StoreScopeGuard implements CanActivate {
  constructor(private readonly storeService: StoreService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    if (!request.user) {
      throw new UnauthorizedException('Authentication required');
    }

    const slug = this.extractSlug(request);
    if (!slug) {
      return true;
    }

    const store = await this.storeService.findBySlug(slug);
    if (!store) {
      throw new NotFoundException('Store not found');
    }

    const isAllowed =
      request.user.role === UserRole.OWNER
        ? store.ownerId === request.user.sub
        : request.user.storeId === store.id;
    if (!isAllowed) {
      throw new ForbiddenException('This account belongs to another store');
    }
    return true;
  }

  private extractSlug(request: Request): string | null {
    const params = request.params as Record<string, string | undefined>;
    for (const name of SLUG_PARAMS) {
      const value = params[name];
      if (value) {
        return value;
      }
    }
    return null;
  }
}
