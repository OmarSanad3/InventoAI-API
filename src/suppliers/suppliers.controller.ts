import {
  Body,
  Controller,
  Delete,
  Get,
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
import { MessageResponseDto } from '../users/dto/message-response.dto';
import { UserRole } from '../users/enums/user-role.enum';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { ListSuppliersQueryDto } from './dto/list-suppliers-query.dto';
import { SupplierResponseDto } from './dto/supplier-response.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { SupplierService } from './supplier.service';

/** The store's supplier book. Dashboard only — no storefront route exists. */
@Controller('suppliers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.OWNER, UserRole.ADMIN)
export class SuppliersController {
  constructor(private readonly supplierService: SupplierService) {}

  @Post()
  async create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateSupplierDto,
  ): Promise<SupplierResponseDto> {
    const supplier = await this.supplierService.create(user, dto);
    return SupplierResponseDto.fromEntity(supplier);
  }

  @Get()
  async list(
    @CurrentUser() user: JwtPayload,
    @Query() query: ListSuppliersQueryDto,
  ): Promise<PaginatedResponseDto<SupplierResponseDto>> {
    const { items, total } = await this.supplierService.list(user, query);
    return PaginatedResponseDto.of(
      items.map((supplier) => SupplierResponseDto.fromEntity(supplier)),
      total,
      query,
    );
  }

  @Get(':id')
  async getById(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SupplierResponseDto> {
    const supplier = await this.supplierService.getById(user, id);
    return SupplierResponseDto.fromEntity(supplier);
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSupplierDto,
  ): Promise<SupplierResponseDto> {
    const supplier = await this.supplierService.update(user, id, dto);
    return SupplierResponseDto.fromEntity(supplier);
  }

  @Delete(':id')
  async remove(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MessageResponseDto> {
    await this.supplierService.remove(user, id);
    return { message: 'Supplier deleted' };
  }
}
