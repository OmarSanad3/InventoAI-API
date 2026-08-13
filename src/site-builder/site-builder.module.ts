import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { CatalogModule } from '../catalog/catalog.module';
import { RolesGuard } from '../common/guards/roles.guard';
import { SiteBuildDraft } from './entities/site-build-draft.entity';
import { StoreTheme } from './entities/store-theme.entity';
import { Store } from './entities/store.entity';
import { SiteBuilderController } from './site-builder.controller';
import { SiteBuilderService } from './site-builder.service';
import { SiteController } from './site.controller';
import { StoresController } from './stores.controller';
import { StoreThemeService } from './store-theme.service';
import { StoreService } from './store.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([SiteBuildDraft, Store, StoreTheme]),
    AuthModule,
    forwardRef(() => CatalogModule),
  ],
  controllers: [SiteBuilderController, StoresController, SiteController],
  providers: [SiteBuilderService, StoreService, StoreThemeService, RolesGuard],
  exports: [SiteBuilderService, StoreService],
})
export class SiteBuilderModule {}
