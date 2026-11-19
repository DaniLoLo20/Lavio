import { Controller, Get, Injectable, Module } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../prisma/prisma.module';

@Injectable()
export class CatalogService {
  constructor(private prisma: PrismaService) {}

  async vehicles() {
    const brands = await this.prisma.vehicleBrand.findMany({
      orderBy: { name: 'asc' },
      include: { models: { select: { name: true }, orderBy: { name: 'asc' } } },
    });
    return brands.map((b) => ({ brand: b.name, models: b.models.map((m) => m.name) }));
  }
}

@ApiTags('catalog')
@ApiBearerAuth()
@Controller('catalog')
export class CatalogController {
  constructor(private svc: CatalogService) {}
  /** Marcas con sus modelos (cualquier usuario autenticado). */
  @Get('vehicles') vehicles() { return this.svc.vehicles(); }
}

@Module({ controllers: [CatalogController], providers: [CatalogService] })
export class CatalogModule {}
