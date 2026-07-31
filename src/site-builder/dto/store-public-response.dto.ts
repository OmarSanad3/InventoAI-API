import { StoreTheme } from '../entities/store-theme.entity';
import { Store } from '../entities/store.entity';
import { LogoSource } from '../enums/logo-source.enum';
import { StoreHeroDto } from './store-hero.dto';
import { ThemePublicDto } from './theme-public.dto';

/**
 * What the storefront client renders `inventoai.com/SITENAME` from.
 *
 * TODO(catalog): the landing page also needs `featuredProducts` and
 * `featuredCategories`, both owner-curated from the dashboard. They are absent
 * because `Product` and `Category` do not exist yet — add them here when the
 * catalog module lands. Tracked in TODO.md.
 */
export class StorePublicResponseDto {
  name!: string;
  slug!: string;
  description!: string | null;
  logoUrl!: string | null;
  logoSource!: LogoSource | null;
  locale!: string;
  hero!: StoreHeroDto;
  theme!: ThemePublicDto | null;

  static fromEntity(
    store: Store,
    theme: StoreTheme | null,
  ): StorePublicResponseDto {
    const dto = new StorePublicResponseDto();
    dto.name = store.name;
    dto.slug = store.slug;
    dto.description = store.description;
    dto.logoUrl = store.logoUrl;
    dto.logoSource = store.logoSource;
    dto.locale = store.locale;
    dto.hero = StoreHeroDto.fromEntity(store);
    dto.theme = theme ? ThemePublicDto.fromEntity(theme) : null;
    return dto;
  }
}
