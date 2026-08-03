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
import { ReorderDto } from '../common/dto/reorder.dto';
import { RolesGuard } from '../common/guards/roles.guard';
import { MessageResponseDto } from '../users/dto/message-response.dto';
import { UserRole } from '../users/enums/user-role.enum';
import { AttributeQueryDto } from './dto/attribute-query.dto';
import { AttributeResponseDto } from './dto/attribute-response.dto';
import { CreateAttributeDto } from './dto/create-attribute.dto';
import { CreateAttributeValueDto } from './dto/create-attribute-value.dto';
import { UpdateAttributeDto } from './dto/update-attribute.dto';
import { UpdateAttributeValueDto } from './dto/update-attribute-value.dto';
import { ProductAttributeService } from './product-attribute.service';

/**
 * Dashboard management of the store's own attributes. There is no public half:
 * the definitions alone are not a storefront feature — the sidebar also needs
 * per-value product counts, which ship with the products branch.
 *
 * Every value route returns the **whole** attribute. The dashboard is editing
 * one object, so returning it saves a re-fetch after each edit.
 */
@Controller('product-attributes')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.OWNER, UserRole.ADMIN)
export class ProductAttributesController {
  constructor(
    private readonly productAttributeService: ProductAttributeService,
  ) {}

  @Post()
  async create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateAttributeDto,
  ): Promise<AttributeResponseDto> {
    const attribute = await this.productAttributeService.create(user, dto);
    return AttributeResponseDto.fromEntity(attribute);
  }

  @Get()
  async list(
    @CurrentUser() user: JwtPayload,
    @Query() query: AttributeQueryDto,
  ): Promise<AttributeResponseDto[]> {
    const attributes = await this.productAttributeService.list(user, query);
    return attributes.map((attribute) =>
      AttributeResponseDto.fromEntity(attribute),
    );
  }

  /**
   * Declared before `PATCH :id` on purpose — Nest matches in declaration order,
   * so `reorder` would otherwise be swallowed as an id.
   */
  @Patch('reorder')
  async reorder(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ReorderDto,
  ): Promise<AttributeResponseDto[]> {
    const attributes = await this.productAttributeService.reorder(user, dto);
    return attributes.map((attribute) =>
      AttributeResponseDto.fromEntity(attribute),
    );
  }

  @Get(':id')
  async getById(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AttributeResponseDto> {
    const attribute = await this.productAttributeService.getById(user, id);
    return AttributeResponseDto.fromEntity(attribute);
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAttributeDto,
  ): Promise<AttributeResponseDto> {
    const attribute = await this.productAttributeService.update(user, id, dto);
    return AttributeResponseDto.fromEntity(attribute);
  }

  @Delete(':id')
  async remove(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MessageResponseDto> {
    await this.productAttributeService.remove(user, id);
    return { message: 'Attribute deleted' };
  }

  @Post(':id/values')
  async addValue(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateAttributeValueDto,
  ): Promise<AttributeResponseDto> {
    const attribute = await this.productAttributeService.addValue(
      user,
      id,
      dto,
    );
    return AttributeResponseDto.fromEntity(attribute);
  }

  /** Before `:valueId`, for the same declaration-order reason as `reorder`. */
  @Patch(':id/values/reorder')
  async reorderValues(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReorderDto,
  ): Promise<AttributeResponseDto> {
    const attribute = await this.productAttributeService.reorderValues(
      user,
      id,
      dto,
    );
    return AttributeResponseDto.fromEntity(attribute);
  }

  @Patch(':id/values/:valueId')
  async updateValue(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('valueId', ParseUUIDPipe) valueId: string,
    @Body() dto: UpdateAttributeValueDto,
  ): Promise<AttributeResponseDto> {
    const attribute = await this.productAttributeService.updateValue(
      user,
      id,
      valueId,
      dto,
    );
    return AttributeResponseDto.fromEntity(attribute);
  }

  @Delete(':id/values/:valueId')
  async removeValue(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('valueId', ParseUUIDPipe) valueId: string,
  ): Promise<AttributeResponseDto> {
    const attribute = await this.productAttributeService.removeValue(
      user,
      id,
      valueId,
    );
    return AttributeResponseDto.fromEntity(attribute);
  }
}
