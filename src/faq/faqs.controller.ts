import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
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
import { CreateFaqDto } from './dto/create-faq.dto';
import { FaqResponseDto } from './dto/faq-response.dto';
import { UpdateFaqDto } from './dto/update-faq.dto';
import { FaqService } from './faq.service';

/** Dashboard management of the caller's own store FAQ. */
@Controller('faqs')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.OWNER, UserRole.ADMIN)
export class FaqsController {
  constructor(private readonly faqService: FaqService) {}

  @Post()
  async create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateFaqDto,
  ): Promise<FaqResponseDto> {
    const faq = await this.faqService.create(user, dto);
    return FaqResponseDto.fromEntity(faq);
  }

  @Get()
  async list(@CurrentUser() user: JwtPayload): Promise<FaqResponseDto[]> {
    const faqs = await this.faqService.list(user);
    return faqs.map((faq) => FaqResponseDto.fromEntity(faq));
  }

  /**
   * Declared before `PATCH :id` on purpose — Nest matches in declaration order,
   * so `reorder` would otherwise be swallowed as an id.
   */
  @Patch('reorder')
  async reorder(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ReorderDto,
  ): Promise<FaqResponseDto[]> {
    const faqs = await this.faqService.reorder(user, dto);
    return faqs.map((faq) => FaqResponseDto.fromEntity(faq));
  }

  @Get(':id')
  async getById(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<FaqResponseDto> {
    const faq = await this.faqService.getById(user, id);
    return FaqResponseDto.fromEntity(faq);
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFaqDto,
  ): Promise<FaqResponseDto> {
    const faq = await this.faqService.update(user, id, dto);
    return FaqResponseDto.fromEntity(faq);
  }

  @Delete(':id')
  async remove(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MessageResponseDto> {
    await this.faqService.remove(user, id);
    return { message: 'FAQ entry deleted' };
  }
}
