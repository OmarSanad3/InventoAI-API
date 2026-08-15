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
import { UserRole } from '../users/enums/user-role.enum';
import { OrderDetailDto } from './dto/order-detail.dto';
import { OrderListItemDto } from './dto/order-list-item.dto';
import { OrderQueryDto } from './dto/order-query.dto';
import { UpdateOrderNoteDto } from './dto/update-order-note.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { OrderService } from './order.service';

/** The owner's order desk: list, inspect, advance, annotate. */
@Controller('orders')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.OWNER, UserRole.ADMIN)
export class OrdersController {
  constructor(private readonly orderService: OrderService) {}

  @Get()
  async list(
    @CurrentUser() user: JwtPayload,
    @Query() query: OrderQueryDto,
  ): Promise<PaginatedResponseDto<OrderListItemDto>> {
    const [orders, total] = await this.orderService.list(user, query);
    return PaginatedResponseDto.of(
      orders.map((order) => OrderListItemDto.fromEntity(order)),
      total,
      query,
    );
  }

  @Get(':id')
  async getById(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OrderDetailDto> {
    const order = await this.orderService.getById(user, id);
    return OrderDetailDto.fromEntity(order);
  }

  /** Moves the order along the machine; an illegal move is a 400 naming both states. */
  @Patch(':id/status')
  async updateStatus(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrderStatusDto,
  ): Promise<OrderDetailDto> {
    const order = await this.orderService.updateStatus(user, id, dto);
    return OrderDetailDto.fromEntity(order);
  }

  @Patch(':id/note')
  async updateNote(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrderNoteDto,
  ): Promise<OrderDetailDto> {
    const order = await this.orderService.updateNote(user, id, dto);
    return OrderDetailDto.fromEntity(order);
  }
}
