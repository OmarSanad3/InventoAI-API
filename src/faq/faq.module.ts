import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { RolesGuard } from '../common/guards/roles.guard';
import { SiteBuilderModule } from '../site-builder/site-builder.module';
import { Faq } from './entities/faq.entity';
import { FaqService } from './faq.service';
import { FaqsController } from './faqs.controller';
import { PublicFaqsController } from './public-faqs.controller';

/**
 * No `forwardRef`: the dependency runs one way only — the FAQ resolves its
 * store through `StoreService`, and nothing in the site builder reads an FAQ.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Faq]), AuthModule, SiteBuilderModule],
  controllers: [FaqsController, PublicFaqsController],
  providers: [FaqService, RolesGuard],
  exports: [FaqService],
})
export class FaqModule {}
