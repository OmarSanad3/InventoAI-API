import { Controller, Get, Param } from '@nestjs/common';
import { FaqPublicDto } from './dto/faq-public.dto';
import { FaqService } from './faq.service';

/**
 * The storefront's `inventoai.com/SITENAME/faq` page. No guard — a live store's
 * FAQ is public. A draft slug 404s, because `resolvePublicStore` hides it.
 */
@Controller('site/:slug/faqs')
export class PublicFaqsController {
  constructor(private readonly faqService: FaqService) {}

  @Get()
  async list(@Param('slug') slug: string): Promise<FaqPublicDto[]> {
    const faqs = await this.faqService.listPublished(slug);
    return faqs.map((faq) => FaqPublicDto.fromEntity(faq));
  }
}
