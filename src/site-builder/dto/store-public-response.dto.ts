import { CategoryPublicDto } from '../../catalog/dto/category-public.dto';
import { ProductPublicListItemDto } from '../../catalog/dto/product-public-list-item.dto';
import { StoreTheme } from '../entities/store-theme.entity';
import { Store } from '../entities/store.entity';
import { LogoSource } from '../enums/logo-source.enum';
import { StoreHeroDto } from './store-hero.dto';
import { ThemePublicDto } from './theme-public.dto';

/** The owner-curated content the landing page is assembled from. */
export interface StoreFeaturedContent {
  readonly categories: CategoryPublicDto[];
  readonly products: ProductPublicListItemDto[];
}

/** What the storefront client renders `inventoai.com/SITENAME` from. */
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
  featuredProducts!: ProductPublicListItemDto[];

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
    dto.hero = StoreHeroDto.fromEntity(store, { withDefaults: true });
    dto.theme = theme ? ThemePublicDto.fromEntity(theme) : null;
    dto.featuredCategories = featured.categories;
    dto.featuredProducts = featured.products;
    return dto;
  }
}
