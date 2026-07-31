import {
  Body,
  Controller,
  FileTypeValidator,
  MaxFileSizeValidator,
  ParseFilePipe,
  Patch,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { UserRole } from '../users/enums/user-role.enum';
import { StoreHeroDto } from './dto/store-hero.dto';
import { UpdateHeroDto } from './dto/update-hero.dto';
import {
  HERO_MAX_SIZE_BYTES,
  HERO_MIME_TYPE_PATTERN,
} from './site-builder.constants';
import { StoreService } from './store.service';

/** Multer's hard cap; the friendly 400 comes from `MaxFileSizeValidator`. */
const HERO_UPLOAD_LIMIT_BYTES = HERO_MAX_SIZE_BYTES * 2;

/** Dashboard management of the caller's own store. */
@Controller('stores')
@UseGuards(JwtAuthGuard, RolesGuard)
export class StoresController {
  constructor(private readonly storeService: StoreService) {}

  @Patch('me/hero')
  @Roles(UserRole.OWNER)
  @UseInterceptors(
    FileInterceptor('image', {
      limits: { fileSize: HERO_UPLOAD_LIMIT_BYTES, files: 1 },
    }),
  )
  async updateHero(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateHeroDto,
    @UploadedFile(
      new ParseFilePipe({
        fileIsRequired: false,
        validators: [
          new MaxFileSizeValidator({ maxSize: HERO_MAX_SIZE_BYTES }),
          new FileTypeValidator({
            fileType: HERO_MIME_TYPE_PATTERN,
            skipMagicNumbersValidation: true,
          }),
        ],
      }),
    )
    image?: Express.Multer.File,
  ): Promise<StoreHeroDto> {
    const store = await this.storeService.updateHero({
      ownerId: user.sub,
      hero: dto,
      image: image?.buffer,
    });
    return StoreHeroDto.fromEntity(store);
  }
}
