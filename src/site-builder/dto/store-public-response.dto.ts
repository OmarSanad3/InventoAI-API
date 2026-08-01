import { CategoryPublicDto } from '../../catalog/dto/category-public.dto';
import { StoreTheme } from '../entities/store-theme.entity';
import { Store } from '../entities/store.entity';
import { LogoSource } from '../enums/logo-source.enum';
import { StoreHeroDto } from './store-hero.dto';
import { ThemePublicDto } from './theme-public.dto';

/** The owner-curated content the landing page is assembled from. */
export interface StoreFeaturedContent {
  readonly categories: CategoryPublicDto[];
}

/**
 * What the storefront client renders `inventoai.com/SITENAME` from.
 *
 * TODO(catalog): `featuredProducts` still belongs here; it lands with
 * [features/products.md](../../../context/features/products.md), which is what
 * creates the `Product` entity. Tracked in TODO.md.
 */
export class StorePublicResponseDto {
  name!: string;
  slug!: string;
  description!: string | null;
  logoUrl!: string | null;
  logoSource!: LogoSource | null;
  locale!: string;
  currency!: string;
  hero!: StoreHeroDto;
  theme!: ThemePublicDto | null;
  featuredCategories!: CategoryPublicDto[];

  static fromEntity(
    store: Store,
    theme: StoreTheme | null,
    featured: StoreFeaturedContent,
  ): StorePublicResponseDto {
    const dto = new StorePublicResponseDto();
    dto.name = store.name;
    dto.slug = store.slug;
    dto.description = store.description;
    dto.logoUrl = store.logoUrl;
    dto.logoSource = store.logoSource;
    dto.locale = store.locale;
    dto.currency = store.currency;
    dto.hero = StoreHeroDto.fromEntity(store);
    dto.theme = theme ? ThemePublicDto.fromEntity(theme) : null;
    dto.featuredCategories = featured.categories;
    return dto;
  }
}
