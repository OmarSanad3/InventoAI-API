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
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PaginatedResponseDto } from '../common/dto/paginated-response.dto';
import { RolesGuard } from '../common/guards/roles.guard';
import { MessageResponseDto } from '../users/dto/message-response.dto';
import { UserRole } from '../users/enums/user-role.enum';
import {
  CATEGORY_IMAGE_MAX_SIZE_BYTES,
  CATEGORY_IMAGE_MIME_TYPE_PATTERN,
} from './catalog.constants';
import { CategoryService } from './category.service';
import { CategoryQueryDto } from './dto/category-query.dto';
import { CategoryResponseDto } from './dto/category-response.dto';
import { CreateCategoryDto } from './dto/create-category.dto';
import { ReorderCategoriesDto } from './dto/reorder-categories.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

/** Multer's hard cap; the friendly 400 comes from `MaxFileSizeValidator`. */
const CATEGORY_IMAGE_UPLOAD_LIMIT_BYTES = CATEGORY_IMAGE_MAX_SIZE_BYTES * 2;

/** Dashboard management of the caller's own store categories. */
@Controller('categories')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.OWNER, UserRole.ADMIN)
export class CategoriesController {
  constructor(private readonly categoryService: CategoryService) {}

  @Post()
  async create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateCategoryDto,
  ): Promise<CategoryResponseDto> {
    const category = await this.categoryService.create(user, dto);
    return CategoryResponseDto.fromEntity(category);
  }

  @Get()
  async list(
    @CurrentUser() user: JwtPayload,
    @Query() query: CategoryQueryDto,
  ): Promise<PaginatedResponseDto<CategoryResponseDto>> {
    const [categories, total] = await this.categoryService.list(user, query);
    return PaginatedResponseDto.of(
      categories.map((category) => CategoryResponseDto.fromEntity(category)),
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
    @Body() dto: ReorderCategoriesDto,
  ): Promise<CategoryResponseDto[]> {
    const categories = await this.categoryService.reorder(user, dto);
    return categories.map((category) =>
      CategoryResponseDto.fromEntity(category),
    );
  }

  @Get(':id')
  async getById(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CategoryResponseDto> {
    const category = await this.categoryService.getById(user, id);
    return CategoryResponseDto.fromEntity(category);
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
  ): Promise<CategoryResponseDto> {
    const category = await this.categoryService.update(user, id, dto);
    return CategoryResponseDto.fromEntity(category);
  }

  @Delete(':id')
  async remove(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MessageResponseDto> {
    await this.categoryService.remove(user, id);
    return { message: 'Category deleted' };
  }

  @Put(':id/image')
  @UseInterceptors(
    FileInterceptor('image', {
      limits: { fileSize: CATEGORY_IMAGE_UPLOAD_LIMIT_BYTES, files: 1 },
    }),
  )
  async replaceImage(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: CATEGORY_IMAGE_MAX_SIZE_BYTES }),
          new FileTypeValidator({
            fileType: CATEGORY_IMAGE_MIME_TYPE_PATTERN,
            skipMagicNumbersValidation: true,
          }),
        ],
      }),
    )
    image: Express.Multer.File,
  ): Promise<CategoryResponseDto> {
    const category = await this.categoryService.replaceImage(
      user,
      id,
      image.buffer,
    );
    return CategoryResponseDto.fromEntity(category);
  }

  @Delete(':id/image')
  async removeImage(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CategoryResponseDto> {
    const category = await this.categoryService.removeImage(user, id);
    return CategoryResponseDto.fromEntity(category);
  }
}
