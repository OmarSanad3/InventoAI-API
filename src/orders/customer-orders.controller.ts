import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PaginatedResponseDto } from '../common/dto/paginated-response.dto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { StoreScopeGuard } from '../common/guards/store-scope.guard';
import { CheckoutService } from './checkout.service';
import { CustomerOrderService } from './customer-order.service';
import { CancelOrderDto } from './dto/cancel-order.dto';
import { OrderListItemDto } from './dto/order-list-item.dto';
import { OrderResponseDto } from './dto/order-response.dto';
import { CreateOrderDto } from './dto/create-order.dto';

/**
 * The storefront's checkout and order history, under
 * `inventoai.com/SITENAME/...`.
 *
 * Not a public controller despite the `/site/:slug` prefix: `StoreScopeGuard`
 * rejects a token issued for another store, and every route below narrows
 * further to the caller's own rows. Orders are addressed by `orderNumber` —
 * the number in the customer's confirmation.
 */
@Controller('site/:slug/orders')
@UseGuards(JwtAuthGuard, StoreScopeGuard)
export class CustomerOrdersController {
  constructor(
    private readonly checkoutService: CheckoutService,
    private readonly customerOrderService: CustomerOrderService,
  ) {}

  @Post()
  async place(
    @CurrentUser() user: JwtPayload,
    @Param('slug') slug: string,
    @Body() dto: CreateOrderDto,
  ): Promise<OrderResponseDto> {
    const order = await this.checkoutService.placeOrder({ user, slug, dto });
    return OrderResponseDto.fromEntity(order);
  }

  @Get('me')
  async listMine(
    @CurrentUser() user: JwtPayload,
    @Param('slug') slug: string,
    @Query() query: PaginationQueryDto,
  ): Promise<PaginatedResponseDto<OrderListItemDto>> {
    const [orders, total] = await this.customerOrderService.listMine(
      user,
      slug,
      query,
    );
    return PaginatedResponseDto.of(
      orders.map((order) => OrderListItemDto.fromEntity(order)),
      total,
      query,
    );
  }

  @Get('me/:orderNumber')
  async getMine(
    @CurrentUser() user: JwtPayload,
    @Param('slug') slug: string,
    @Param('orderNumber', ParseIntPipe) orderNumber: number,
  ): Promise<OrderResponseDto> {
    const order = await this.customerOrderService.getMine(
      user,
      slug,
      orderNumber,
    );
    return OrderResponseDto.fromEntity(order);
  }

  @Post('me/:orderNumber/cancel')
  async cancelMine(
    @CurrentUser() user: JwtPayload,
    @Param('slug') slug: string,
    @Param('orderNumber', ParseIntPipe) orderNumber: number,
    @Body() dto: CancelOrderDto,
  ): Promise<OrderResponseDto> {
    const order = await this.customerOrderService.cancelMine(
      user,
      slug,
      orderNumber,
      dto,
    );
    return OrderResponseDto.fromEntity(order);
  }
}
