import { Body, Controller, Delete, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsOptional, IsString } from 'class-validator';
import { ContactPreference } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.module';
import { AuthUser, CurrentUser, Perms, PermsAny, Roles } from '../../common/guards';

class ClientDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsEnum(ContactPreference) contactPreference?: ContactPreference;
}

@Injectable()
export class ClientsService {
  constructor(private prisma: PrismaService) {}

  list(tenantId: string, search?: string) {
    return this.prisma.client.findMany({
      where: {
        tenantId, deletedAt: null,
        ...(search ? { OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search } },
          { email: { contains: search, mode: 'insensitive' } },
          { vehicles: { some: { plate: { contains: search.toUpperCase() } } } },
        ] } : {}),
      },
      include: { vehicles: { where: { deletedAt: null }, select: { id: true, plate: true, brand: true, model: true } }, _count: { select: { orders: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  /** Indice liviano para el autocompletado del POS y del Modo Voz (se guarda en cache para uso sin conexion). */
  lookup(tenantId: string) {
    return this.prisma.client.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, name: true, phone: true, email: true, contactPreference: true, vehicles: { where: { deletedAt: null }, select: { plate: true, brand: true, model: true, color: true } } },
      orderBy: { updatedAt: 'desc' },
      take: 2000,
    });
  }

  create(u: AuthUser, dto: ClientDto) {
    return this.prisma.client.create({ data: { ...dto, tenantId: u.tenantId, createdById: u.sub } });
  }

  async update(u: AuthUser, id: string, dto: ClientDto) {
    const r = await this.prisma.client.updateMany({ where: { id, tenantId: u.tenantId, deletedAt: null }, data: { ...dto, updatedById: u.sub } });
    if (!r.count) throw new NotFoundException();
    return this.prisma.client.findUnique({ where: { id } });
  }

  async remove(u: AuthUser, id: string) {
    const r = await this.prisma.client.updateMany({ where: { id, tenantId: u.tenantId, deletedAt: null }, data: { deletedAt: new Date(), updatedById: u.sub } });
    if (!r.count) throw new NotFoundException();
    return { ok: true };
  }
}

@ApiTags('clients')
@ApiBearerAuth()
@Controller('clients')
export class ClientsController {
  constructor(private svc: ClientsService) {}
  @PermsAny('clients:view', 'orders:create') @Get('lookup') lookup(@CurrentUser() u: AuthUser) { return this.svc.lookup(u.tenantId); }
  @Perms('clients:view') @Get() list(@CurrentUser() u: AuthUser, @Query('search') s?: string) { return this.svc.list(u.tenantId, s); }
  @Perms('clients:create') @Post() create(@CurrentUser() u: AuthUser, @Body() dto: ClientDto) { return this.svc.create(u, dto); }
  @Perms('clients:edit') @Patch(':id') update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ClientDto) { return this.svc.update(u, id, dto); }
  @Perms('clients:delete') @Delete(':id') remove(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.remove(u, id); }
}

@Module({ controllers: [ClientsController], providers: [ClientsService] })
export class ClientsModule {}
