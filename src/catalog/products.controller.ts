import {
  Body,
  Controller,
  Delete,
  FileTypeValidator,
  Get,
  MaxFileSizeValidator,
  Param,
  ParseFilePipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PaginatedResponseDto } from '../common/dto/paginated-response.dto';
import { ReorderDto } from '../common/dto/reorder.dto';
import { RolesGuard } from '../common/guards/roles.guard';
import { MessageResponseDto } from '../users/dto/message-response.dto';
import { UserRole } from '../users/enums/user-role.enum';
import {
  MAX_PRODUCT_IMAGES,
  PRODUCT_IMAGE_MAX_SIZE_BYTES,
  PRODUCT_IMAGE_MIME_TYPE_PATTERN,
} from './catalog.constants';
import { CreateProductDto } from './dto/create-product.dto';
import { CreateVariantDto } from './dto/create-variant.dto';
import { GenerateVariantsDto } from './dto/generate-variants.dto';
import { ProductListItemDto } from './dto/product-list-item.dto';
import { ProductQueryDto } from './dto/product-query.dto';
import { ProductResponseDto } from './dto/product-response.dto';
import { UpdateImageDto } from './dto/update-image.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { UpdateVariantDto } from './dto/update-variant.dto';
import { ProductImageService } from './product-image.service';
import { ProductVariantService } from './product-variant.service';
import { ProductService } from './product.service';

/** Multer's hard cap; the friendly 400 comes from `MaxFileSizeValidator`. */
const PRODUCT_IMAGE_UPLOAD_LIMIT_BYTES = PRODUCT_IMAGE_MAX_SIZE_BYTES * 2;

/**
 * Dashboard management of the caller's own store products, their variants and
 * their images. Every variant and image route returns the **whole** product —
 * the dashboard is editing one object, so returning it saves a re-fetch.
 */
@Controller('products')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.OWNER, UserRole.ADMIN)
export class ProductsController {
  constructor(
    private readonly productService: ProductService,
    private readonly productVariantService: ProductVariantService,
    private readonly productImageService: ProductImageService,
  ) {}

  @Post()
  async create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateProductDto,
  ): Promise<ProductResponseDto> {
    const product = await this.productService.create(user, dto);
    return ProductResponseDto.fromEntity(product);
  }

  @Get()
  async list(
    @CurrentUser() user: JwtPayload,
    @Query() query: ProductQueryDto,
  ): Promise<PaginatedResponseDto<ProductListItemDto>> {
    const [products, total] = await this.productService.list(user, query);
    return PaginatedResponseDto.of(
      products.map((product) => ProductListItemDto.fromEntity(product)),
      total,
      query,
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
  ): Promise<MessageResponseDto> {
    await this.productService.reorder(user, dto);
    return { message: 'Products reordered' };
  }

  @Get(':id')
  async getById(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ProductResponseDto> {
    const product = await this.productService.getById(user, id);
    return ProductResponseDto.fromEntity(product);
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
  ): Promise<ProductResponseDto> {
    const product = await this.productService.update(user, id, dto);
    return ProductResponseDto.fromEntity(product);
  }

  @Delete(':id')
  async remove(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MessageResponseDto> {
    await this.productService.remove(user, id);
    return { message: 'Product deleted' };
  }

  /** Before `:variantId`, for the same declaration-order reason as `reorder`. */
  @Post(':id/variants/generate')
  async generateVariants(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GenerateVariantsDto,
  ): Promise<ProductResponseDto> {
    const product = await this.productVariantService.generateVariants(
      user,
      id,
      dto,
    );
    return ProductResponseDto.fromEntity(product);
  }

  @Post(':id/variants')
  async addVariant(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateVariantDto,
  ): Promise<ProductResponseDto> {
    const product = await this.productVariantService.addVariant(user, id, dto);
    return ProductResponseDto.fromEntity(product);
  }

  @Patch(':id/variants/:variantId')
  async updateVariant(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @Body() dto: UpdateVariantDto,
  ): Promise<ProductResponseDto> {
    const product = await this.productVariantService.updateVariant(
      user,
      id,
      variantId,
      dto,
    );
    return ProductResponseDto.fromEntity(product);
  }

  @Delete(':id/variants/:variantId')
  async removeVariant(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('variantId', ParseUUIDPipe) variantId: string,
  ): Promise<ProductResponseDto> {
    const product = await this.productVariantService.removeVariant(
      user,
      id,
      variantId,
    );
    return ProductResponseDto.fromEntity(product);
  }

  @Post(':id/images')
  @UseInterceptors(
    FilesInterceptor('images', MAX_PRODUCT_IMAGES, {
      limits: { fileSize: PRODUCT_IMAGE_UPLOAD_LIMIT_BYTES },
    }),
  )
  async addImages(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFiles(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: PRODUCT_IMAGE_MAX_SIZE_BYTES }),
          new FileTypeValidator({
            fileType: PRODUCT_IMAGE_MIME_TYPE_PATTERN,
            skipMagicNumbersValidation: true,
          }),
        ],
      }),
    )
    images: Express.Multer.File[],
  ): Promise<ProductResponseDto> {
    const product = await this.productImageService.addImages(user, id, images);
    return ProductResponseDto.fromEntity(product);
  }

  /** Before `:imageId`, for the same declaration-order reason as `reorder`. */
  @Patch(':id/images/reorder')
  async reorderImages(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReorderDto,
  ): Promise<ProductResponseDto> {
    const product = await this.productImageService.reorderImages(user, id, dto);
    return ProductResponseDto.fromEntity(product);
  }

  @Patch(':id/images/:imageId')
  async updateImage(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
    @Body() dto: UpdateImageDto,
  ): Promise<ProductResponseDto> {
    const product = await this.productImageService.updateImage(
      user,
      id,
      imageId,
      dto,
    );
    return ProductResponseDto.fromEntity(product);
  }

  @Delete(':id/images/:imageId')
  async removeImage(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
  ): Promise<ProductResponseDto> {
    const product = await this.productImageService.removeImage(
      user,
      id,
      imageId,
    );
    return ProductResponseDto.fromEntity(product);
  }
}
