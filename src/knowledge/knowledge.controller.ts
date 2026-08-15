import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { UserRole } from '../users/enums/user-role.enum';
import { KnowledgeStatusDto } from './dto/knowledge-status.dto';
import { KnowledgeService } from './knowledge.service';

/**
 * The owner's window onto their store's knowledge base. Dashboard only — the
 * storefront reads nothing from here until the chatbot lands.
 */
@Controller('knowledge')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.OWNER, UserRole.ADMIN)
export class KnowledgeController {
  constructor(private readonly knowledgeService: KnowledgeService) {}

  @Get('status')
  async getStatus(
    @CurrentUser() user: JwtPayload,
  ): Promise<KnowledgeStatusDto> {
    return this.knowledgeService.getStatus(user);
  }

  /** 200, not 202: nothing is created, and the counts are the useful answer. */
  @Post('reindex')
  @HttpCode(HttpStatus.OK)
  async reindex(@CurrentUser() user: JwtPayload): Promise<KnowledgeStatusDto> {
    return this.knowledgeService.reindex(user);
  }
}
