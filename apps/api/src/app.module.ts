import { Module } from '@nestjs/common';
import { AdminGuard } from './admin.guard';
import {
  AdminController,
  CatalogController,
  OperationsController,
  OrdersController,
  PaymentsController,
} from './shop.controller';
import { MetricsService } from './metrics.service';
import { ShopService } from './shop.service';

@Module({
  controllers: [
    CatalogController,
    OrdersController,
    PaymentsController,
    AdminController,
    OperationsController,
  ],
  providers: [ShopService, MetricsService, AdminGuard],
})
export class AppModule {}
