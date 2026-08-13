import {
  Body,
  Controller,
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
import { CatalogAiService } from './catalog-ai.service';
import { ApplyCatalogDto } from './dto/apply-catalog.dto';
import { ApplyCatalogResultDto } from './dto/apply-catalog-result.dto';
import { CatalogProposalDto } from './dto/catalog-proposal.dto';
import { GenerateCatalogDto } from './dto/generate-catalog.dto';

/**
 * The AI catalog setup, in two calls: `generate` proposes and persists nothing,
 * `apply` writes what the owner kept. No public surface — a shopper never sees
 * a proposal.
 */
@Controller('catalog')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.OWNER, UserRole.ADMIN)
export class CatalogSetupController {
  constructor(private readonly catalogAiService: CatalogAiService) {}

  /** 200 rather than 201: a proposal is not a created resource. */
  @Post('generate')
  @HttpCode(HttpStatus.OK)
  async generate(
    @CurrentUser() user: JwtPayload,
    @Body() dto: GenerateCatalogDto,
  ): Promise<CatalogProposalDto> {
    const proposal = await this.catalogAiService.generate(user, dto);
    return CatalogProposalDto.fromProposal(proposal);
  }

  @Post('apply')
  @HttpCode(HttpStatus.OK)
  async apply(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ApplyCatalogDto,
  ): Promise<ApplyCatalogResultDto> {
    return this.catalogAiService.applyCatalog(user, dto);
  }
}
