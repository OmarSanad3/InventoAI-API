import {
  Body,
  Controller,
  FileTypeValidator,
  Get,
  HttpCode,
  HttpStatus,
  MaxFileSizeValidator,
  ParseFilePipe,
  Post,
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
import { BrainstormResponseDto } from './dto/brainstorm-response.dto';
import { BrainstormDto } from './dto/brainstorm.dto';
import { ConfirmDomainResponseDto } from './dto/confirm-domain-response.dto';
import { ConfirmDomainDto } from './dto/confirm-domain.dto';
import { PublishSiteResponseDto } from './dto/publish-site-response.dto';
import { PublishSiteDto } from './dto/publish-site.dto';
import { QuestionsResponseDto } from './dto/questions-response.dto';
import { SubmitAnswersResponseDto } from './dto/submit-answers-response.dto';
import { SubmitAnswersDto } from './dto/submit-answers.dto';
import { ThemesResponseDto } from './dto/theme-response.dto';
import {
  LOGO_MAX_SIZE_BYTES,
  LOGO_MIME_TYPE_PATTERN,
} from './site-builder.constants';
import { SiteBuilderService } from './site-builder.service';

/** Multer's hard cap; the friendly 400 comes from `MaxFileSizeValidator`. */
const LOGO_UPLOAD_LIMIT_BYTES = LOGO_MAX_SIZE_BYTES * 2;

@Controller('site-builder')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SiteBuilderController {
  constructor(private readonly siteBuilderService: SiteBuilderService) {}

  @Get('questions')
  getQuestions(): QuestionsResponseDto {
    return this.siteBuilderService.getQuestions();
  }

  @Post('brainstorm')
  @Roles(UserRole.OWNER)
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('logo', {
      limits: { fileSize: LOGO_UPLOAD_LIMIT_BYTES, files: 1 },
    }),
  )
  saveBrainstorm(
    @CurrentUser() user: JwtPayload,
    @Body() dto: BrainstormDto,
    @UploadedFile(
      new ParseFilePipe({
        fileIsRequired: false,
        validators: [
          new MaxFileSizeValidator({ maxSize: LOGO_MAX_SIZE_BYTES }),
          new FileTypeValidator({
            fileType: LOGO_MIME_TYPE_PATTERN,
            skipMagicNumbersValidation: true,
          }),
        ],
      }),
    )
    logo?: Express.Multer.File,
  ): Promise<BrainstormResponseDto> {
    return this.siteBuilderService.saveBrainstorm({
      ownerId: user.sub,
      brainstorm: dto.brainstorm,
      logo: logo?.buffer,
    });
  }

  @Post('answers')
  @Roles(UserRole.OWNER)
  @HttpCode(HttpStatus.OK)
  submitAnswers(
    @CurrentUser() user: JwtPayload,
    @Body() dto: SubmitAnswersDto,
  ): Promise<SubmitAnswersResponseDto> {
    return this.siteBuilderService.submitAnswers({
      ownerId: user.sub,
      answers: dto.questions,
    });
  }

  @Post('domain')
  @Roles(UserRole.OWNER)
  confirmDomain(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ConfirmDomainDto,
  ): Promise<ConfirmDomainResponseDto> {
    return this.siteBuilderService.confirmDomain({
      ownerId: user.sub,
      businessName: dto.businessName,
      domain: dto.domain,
    });
  }

  @Post('themes')
  @Roles(UserRole.OWNER)
  generateThemes(@CurrentUser() user: JwtPayload): Promise<ThemesResponseDto> {
    return this.siteBuilderService.generateThemes(user.sub);
  }

  @Get('themes')
  @Roles(UserRole.OWNER)
  listThemes(@CurrentUser() user: JwtPayload): Promise<ThemesResponseDto> {
    return this.siteBuilderService.listThemes(user.sub);
  }

  @Post('publish')
  @Roles(UserRole.OWNER)
  @HttpCode(HttpStatus.OK)
  publish(
    @CurrentUser() user: JwtPayload,
    @Body() dto: PublishSiteDto,
  ): Promise<PublishSiteResponseDto> {
    return this.siteBuilderService.publish({
      ownerId: user.sub,
      themeId: dto.themeId,
    });
  }
}
