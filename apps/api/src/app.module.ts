import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PortfolioCleanup, PortfolioController, PortfolioGuard } from './portfolio-demo';
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
    PortfolioController,
  ],
  providers: [
    ShopService,
    MetricsService,
    AdminGuard,
    PortfolioCleanup,
    { provide: APP_GUARD, useClass: PortfolioGuard },
  ],
})
/** Корневой composition root API: связывает HTTP-контроллеры и сервисы. */
export class AppModule {}
