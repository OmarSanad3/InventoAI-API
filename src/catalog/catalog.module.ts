import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { RolesGuard } from '../common/guards/roles.guard';
import { SiteBuilderModule } from '../site-builder/site-builder.module';
import { CategoriesController } from './categories.controller';
import { CategoryService } from './category.service';
import { Category } from './entities/category.entity';
import { PublicCategoriesController } from './public-categories.controller';

/**
 * `forwardRef` because the dependency genuinely goes both ways: the catalog
 * resolves its store through `StoreService`, and the landing page's featured
 * strip comes from `CategoryService`.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Category]),
    AuthModule,
    forwardRef(() => SiteBuilderModule),
  ],
  controllers: [CategoriesController, PublicCategoriesController],
  providers: [CategoryService, RolesGuard],
  exports: [CategoryService],
})
export class CatalogModule {}
