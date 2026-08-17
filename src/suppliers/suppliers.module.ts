import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiModule } from '../ai/ai.module';
import { AuthModule } from '../auth/auth.module';
import { CatalogModule } from '../catalog/catalog.module';
import { RolesGuard } from '../common/guards/roles.guard';
import { SiteBuilderModule } from '../site-builder/site-builder.module';
import { User } from '../users/entities/user.entity';
import { PurchaseRequest } from './entities/purchase-request.entity';
import { Supplier } from './entities/supplier.entity';
import { SupplierOffer } from './entities/supplier-offer.entity';
import { PurchaseRequestService } from './purchase-request.service';
import { PurchaseRequestsController } from './purchase-requests.controller';
import { SupplierDraftService } from './supplier-draft.service';
import { SupplierMailService } from './supplier-mail.service';
import { SupplierReplyService } from './supplier-reply.service';
import { SupplierService } from './supplier.service';
import { SuppliersController } from './suppliers.controller';

/**
 * From "low stock" to "deal closed": the supplier book, the drafted request,
 * the replies read into numbers, and the button that closes the deal.
 *
 * **Nothing imports this module**, and it imports no feature module that could
 * import it back — `CatalogModule` for the variant it is reordering,
 * `SiteBuilderModule` for `StoreService`, `AiModule` for the two narrow Gemini
 * calls. `MailModule` is global, so mail needs no import at all.
 *
 * In particular it does **not** import `AdvisorModule`, and the Advisor does
 * not import this. The link between "reorder 18 units" and a purchase request
 * is the dashboard: the restock insight's payload already carries the variant
 * id and the recommended quantity, and the button posts them.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Supplier, PurchaseRequest, SupplierOffer, User]),
    AuthModule,
    SiteBuilderModule,
    CatalogModule,
    AiModule,
  ],
  controllers: [SuppliersController, PurchaseRequestsController],
  providers: [
    SupplierService,
    PurchaseRequestService,
    SupplierDraftService,
    SupplierMailService,
    SupplierReplyService,
    RolesGuard,
  ],
})
export class SuppliersModule {}
