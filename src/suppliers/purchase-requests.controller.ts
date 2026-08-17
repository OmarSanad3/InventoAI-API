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
import { CreatePurchaseRequestDto } from './dto/create-purchase-request.dto';
import { ListPurchaseRequestsQueryDto } from './dto/list-purchase-requests-query.dto';
import { PurchaseRequestDetailDto } from './dto/purchase-request-detail.dto';
import { PurchaseRequestResponseDto } from './dto/purchase-request-response.dto';
import { SubmitReplyDto } from './dto/submit-reply.dto';
import { UpdateOfferDto } from './dto/update-offer.dto';
import { UpdatePurchaseRequestDto } from './dto/update-purchase-request.dto';
import { PurchaseRequestService } from './purchase-request.service';
import { SupplierReplyService } from './supplier-reply.service';

/**
 * "We need more of these" → "the deal is closed", in nine routes.
 *
 * Every one returns the whole request with its offers re-ranked, because a
 * ranking is a property of the set: one reply arriving moves every other row.
 */
@Controller('purchase-requests')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.OWNER, UserRole.ADMIN)
export class PurchaseRequestsController {
  constructor(
    private readonly purchaseRequestService: PurchaseRequestService,
    private readonly supplierReplyService: SupplierReplyService,
  ) {}

  /** Drafts the email and lists the recipients. Sends nothing. */
  @Post()
  async create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreatePurchaseRequestDto,
  ): Promise<PurchaseRequestDetailDto> {
    const request = await this.purchaseRequestService.create(user, dto);
    return PurchaseRequestDetailDto.fromEntity(request);
  }

  @Get()
  async list(
    @CurrentUser() user: JwtPayload,
    @Query() query: ListPurchaseRequestsQueryDto,
  ): Promise<PaginatedResponseDto<PurchaseRequestResponseDto>> {
    const { items, total } = await this.purchaseRequestService.list(
      user,
      query,
    );
    return PaginatedResponseDto.of(
      items.map((request) => PurchaseRequestResponseDto.fromEntity(request)),
      total,
      query,
    );
  }

  @Get(':id')
  async getById(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PurchaseRequestDetailDto> {
    const request = await this.purchaseRequestService.getById(user, id);
    return PurchaseRequestDetailDto.fromEntity(request);
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePurchaseRequestDto,
  ): Promise<PurchaseRequestDetailDto> {
    const request = await this.purchaseRequestService.update(user, id, dto);
    return PurchaseRequestDetailDto.fromEntity(request);
  }

  /** 200 rather than 201: sending creates nothing, it mails what exists. */
  @Post(':id/send')
  @HttpCode(HttpStatus.OK)
  async send(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PurchaseRequestDetailDto> {
    const request = await this.purchaseRequestService.send(user, id);
    return PurchaseRequestDetailDto.fromEntity(request);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PurchaseRequestDetailDto> {
    const request = await this.purchaseRequestService.cancel(user, id);
    return PurchaseRequestDetailDto.fromEntity(request);
  }

  /**
   * The supplier's reply, pasted in whole. The model reads it; the owner can
   * correct it through the route below.
   */
  @Post(':id/offers/:offerId/reply')
  @HttpCode(HttpStatus.OK)
  async submitReply(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('offerId', ParseUUIDPipe) offerId: string,
    @Body() dto: SubmitReplyDto,
  ): Promise<PurchaseRequestDetailDto> {
    const request = await this.supplierReplyService.ingestFromPaste(
      user,
      id,
      offerId,
      dto,
    );
    return PurchaseRequestDetailDto.fromEntity(request);
  }

  @Patch(':id/offers/:offerId')
  async updateOffer(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('offerId', ParseUUIDPipe) offerId: string,
    @Body() dto: UpdateOfferDto,
  ): Promise<PurchaseRequestDetailDto> {
    const request = await this.supplierReplyService.updateOffer(
      user,
      id,
      offerId,
      dto,
    );
    return PurchaseRequestDetailDto.fromEntity(request);
  }

  /** The deal: one supplier confirmed, every other one politely declined. */
  @Post(':id/offers/:offerId/confirm')
  @HttpCode(HttpStatus.OK)
  async confirm(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('offerId', ParseUUIDPipe) offerId: string,
  ): Promise<PurchaseRequestDetailDto> {
    const request = await this.purchaseRequestService.confirm(
      user,
      id,
      offerId,
    );
    return PurchaseRequestDetailDto.fromEntity(request);
  }
}
