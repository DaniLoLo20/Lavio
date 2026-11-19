import { Controller, Get, Module, NotFoundException, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/guards';
import { OrdersModule } from '../orders/orders.module';
import { WashOrderRepository } from '../orders/domain/order.repository';
import { ORDER_STATUSES } from '../orders/domain/order-rules';

@ApiTags('public')
@Controller('public')
export class PublicController {
  constructor(private repo: WashOrderRepository) {}

  /** Consulta sin login por QR o codigo. Sin datos de cliente ni montos. */
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('track/:code')
  async track(@Param('code') raw: string) {
    const code = raw.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) throw new NotFoundException('Código no encontrado');
    const o = await this.repo.findByCode(code);
    if (!o) throw new NotFoundException('Código no encontrado');
    const step = ORDER_STATUSES.indexOf(o.status);
    const plate: string = o.vehicle.plate;
    return {
      business: o.tenant.name,
      logoUrl: o.tenant.logoPath ? `/api/uploads/${o.tenant.logoPath}` : null,
      folio: o.folio,
      code: o.code,
      status: o.status,
      steps: ORDER_STATUSES,
      progress: Math.round((step / (ORDER_STATUSES.length - 1)) * 100),
      vehicle: {
        brand: o.vehicle.brand, model: o.vehicle.model, color: o.vehicle.color,
        plate: plate.length > 3 ? plate.slice(0, 3) + '*'.repeat(plate.length - 3) : plate,
      },
      services: o.items.map((i: any) => ({ name: i.name, quantity: i.quantity })),
      receivedAt: o.receivedAt,
      startedAt: o.startedAt,
      finishedAt: o.finishedAt,
      totalSeconds: o.totalSeconds,
      history: o.statusHistory.map((h: any) => ({ status: h.toStatus, at: h.createdAt })),
      photos: o.photos.map((p: any) => ({ type: p.type, url: `/api/uploads/${p.path}` })),
    };
  }
}

@Module({ imports: [OrdersModule], controllers: [PublicController] })
export class PublicModule {}
