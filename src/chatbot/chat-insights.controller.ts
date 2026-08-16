import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PaginatedResponseDto } from '../common/dto/paginated-response.dto';
import { RolesGuard } from '../common/guards/roles.guard';
import { MessageResponseDto } from '../users/dto/message-response.dto';
import { UserRole } from '../users/enums/user-role.enum';
import { ChatInsightsService } from './chat-insights.service';
import { ChatbotSettingsService } from './chatbot-settings.service';
import { ChatSessionQueryDto } from './dto/chat-session-query.dto';
import { ChatSessionDetailDto } from './dto/chat-session-detail.dto';
import { ChatSessionSummaryDto } from './dto/chat-session-summary.dto';
import { ChatStatsDto } from './dto/chat-stats.dto';
import { ChatbotSettingsDto } from './dto/chatbot-settings.dto';
import { UnansweredGroupDto } from './dto/unanswered-group.dto';
import {
  ChatStatsQueryDto,
  UnansweredQueryDto,
} from './dto/unanswered-query.dto';
import { UpdateChatbotSettingsDto } from './dto/update-chatbot-settings.dto';

/**
 * The owner's window onto their assistant: what it was asked, what it could not
 * answer, and the switches that change how it behaves.
 *
 * Dashboard only. Every route resolves the store from the caller, so a session
 * belonging to another store is a 404 — nothing here takes a slug, and nothing
 * here takes a store id.
 */
@Controller('chat')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.OWNER, UserRole.ADMIN)
export class ChatInsightsController {
  constructor(
    private readonly insightsService: ChatInsightsService,
    private readonly settingsService: ChatbotSettingsService,
  ) {}

  @Get('sessions')
  async listSessions(
    @CurrentUser() user: JwtPayload,
    @Query() query: ChatSessionQueryDto,
  ): Promise<PaginatedResponseDto<ChatSessionSummaryDto>> {
    return this.insightsService.listSessions(user, query);
  }

  /**
   * The dashboard's counterpart to the storefront's transcript route, and
   * unlike that one it needs no capability id: the store scope **is** the
   * authorisation.
   */
  @Get('sessions/:id')
  async getSession(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ChatSessionDetailDto> {
    return this.insightsService.getSession(user, id);
  }

  /** The demand signal: what shoppers asked for and did not get, grouped. */
  @Get('unanswered')
  async listUnanswered(
    @CurrentUser() user: JwtPayload,
    @Query() query: UnansweredQueryDto,
  ): Promise<PaginatedResponseDto<UnansweredGroupDto>> {
    return this.insightsService.listUnanswered(user, query);
  }

  /** Marks the whole theme dealt with, not only the message that named it. */
  @Patch('unanswered/:messageId/review')
  async reviewUnanswered(
    @CurrentUser() user: JwtPayload,
    @Param('messageId', ParseUUIDPipe) messageId: string,
  ): Promise<MessageResponseDto> {
    return this.insightsService.reviewUnanswered(user, messageId);
  }

  @Get('stats')
  async getStats(
    @CurrentUser() user: JwtPayload,
    @Query() query: ChatStatsQueryDto,
  ): Promise<ChatStatsDto> {
    return this.insightsService.getStats(user, query);
  }

  @Get('settings')
  async getSettings(
    @CurrentUser() user: JwtPayload,
  ): Promise<ChatbotSettingsDto> {
    return this.settingsService.getForCaller(user);
  }

  @Patch('settings')
  async updateSettings(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateChatbotSettingsDto,
  ): Promise<ChatbotSettingsDto> {
    return this.settingsService.update(user, dto);
  }
}
