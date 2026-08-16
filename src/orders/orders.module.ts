import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { CatalogModule } from '../catalog/catalog.module';
import { RolesGuard } from '../common/guards/roles.guard';
import { StoreScopeGuard } from '../common/guards/store-scope.guard';
import { SiteBuilderModule } from '../site-builder/site-builder.module';
import { User } from '../users/entities/user.entity';
import { CheckoutService } from './checkout.service';
import { CustomerOrderService } from './customer-order.service';
import { CustomerOrdersController } from './customer-orders.controller';
import { OrderItem } from './entities/order-item.entity';
import { Order } from './entities/order.entity';
import { OrderService } from './order.service';
import { OrdersController } from './orders.controller';

/**
 * No `forwardRef` anywhere: orders depend on the catalog and the site builder,
 * and neither reads an order. `CatalogModule` is imported for `ProductService`,
 * whose `recalculateAggregates` is the single writer of a product's derived
 * stock — checkout and the cancel restore both go through it rather than
 * growing arithmetic of their own.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Order, OrderItem, User]),
    AuthModule,
    CatalogModule,
    SiteBuilderModule,
  ],
  controllers: [OrdersController, CustomerOrdersController],
  providers: [
    CheckoutService,
    CustomerOrderService,
    OrderService,
    RolesGuard,
    StoreScopeGuard,
  ],
  // `CustomerOrderService` is exported for the chatbot's order tools, which
  // must reach an order through the service that already scopes it by store
  // *and* by customer rather than growing a query of their own.
  exports: [OrderService, CustomerOrderService],
})
export class OrdersModule {}
