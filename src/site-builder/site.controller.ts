import { Controller, Get, Param } from '@nestjs/common';
import { StorePublicResponseDto } from './dto/store-public-response.dto';
import { StoreService } from './store.service';

/** Public storefront resolution: what `inventoai.com/SITENAME` is rendered from. */
@Controller('site')
export class SiteController {
  constructor(private readonly storeService: StoreService) {}

  @Get(':slug')
  async getStore(@Param('slug') slug: string): Promise<StorePublicResponseDto> {
    const { store, theme } = await this.storeService.resolvePublicStore(slug);
    return StorePublicResponseDto.fromEntity(store, theme);
  }
}
