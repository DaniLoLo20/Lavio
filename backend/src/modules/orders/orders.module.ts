import { Module } from '@nestjs/common';
import { OrdersController } from './presentation/orders.controller';
import { OrdersService } from './application/orders.service';
import { WashOrderRepository } from './domain/order.repository';
import { PrismaOrderRepository } from './infrastructure/prisma-order.repository';

@Module({
  controllers: [OrdersController],
  providers: [OrdersService, { provide: WashOrderRepository, useClass: PrismaOrderRepository }],
  exports: [WashOrderRepository],
})
export class OrdersModule {}
