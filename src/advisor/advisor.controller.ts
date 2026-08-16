import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PaginatedResponseDto } from '../common/dto/paginated-response.dto';
import { RolesGuard } from '../common/guards/roles.guard';
import { UserRole } from '../users/enums/user-role.enum';
import { AdvisorService } from './advisor.service';
import { AdvisorSettingsService } from './advisor-settings.service';
import {
  AdvisorBriefDetailDto,
  AdvisorBriefSummaryDto,
  LatestBriefDto,
} from './dto/advisor-brief.dto';
import { AdvisorInsightDto } from './dto/advisor-insight.dto';
import { AdvisorSettingsDto } from './dto/advisor-settings.dto';
import { BriefQueryDto } from './dto/brief-query.dto';
import { UpdateAdvisorSettingsDto } from './dto/update-advisor-settings.dto';
import { UpdateInsightStatusDto } from './dto/update-insight-status.dto';

/**
 * The owner's morning brief, and the switches behind it.
 *
 * Dashboard only — a shopper has no business knowing what a store is running
 * out of, so this module has no storefront surface at all. Every route resolves
 * the store from the caller: nothing here takes a slug and nothing here takes a
 * store id, which is what makes another store's brief a 404.
 */
@Controller('advisor')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.OWNER, UserRole.ADMIN)
export class AdvisorController {
  constructor(
    private readonly advisorService: AdvisorService,
    private readonly settingsService: AdvisorSettingsService,
  ) {}

  /** The dashboard panel: the newest brief, and whether it is today's. */
  @Get('brief')
  async getLatestBrief(
    @CurrentUser() user: JwtPayload,
  ): Promise<LatestBriefDto> {
    return this.advisorService.getLatest(user);
  }

  @Get('briefs')
  async listBriefs(
    @CurrentUser() user: JwtPayload,
    @Query() query: BriefQueryDto,
  ): Promise<PaginatedResponseDto<AdvisorBriefSummaryDto>> {
    return this.advisorService.list(user, query);
  }

  @Get('briefs/:id')
  async getBrief(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AdvisorBriefDetailDto> {
    return this.advisorService.getById(user, id);
  }

  /**
   * 200 rather than 201: a brief is a record of a day, and the second press of
   * the button replaces the first rather than creating a second one.
   */
  @Post('generate')
  @HttpCode(HttpStatus.OK)
  async generate(@CurrentUser() user: JwtPayload): Promise<LatestBriefDto> {
    return this.advisorService.generateNow(user);
  }

  @Patch('insights/:id')
  async updateInsight(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInsightStatusDto,
  ): Promise<AdvisorInsightDto> {
    return this.advisorService.updateInsightStatus(user, id, dto);
  }

  @Get('settings')
  async getSettings(
    @CurrentUser() user: JwtPayload,
  ): Promise<AdvisorSettingsDto> {
    return this.settingsService.getForCaller(user);
  }

  @Patch('settings')
  async updateSettings(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateAdvisorSettingsDto,
  ): Promise<AdvisorSettingsDto> {
    return this.settingsService.update(user, dto);
  }
}
