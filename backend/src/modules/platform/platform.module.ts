import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsEnum, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Length, Matches, Max, Min, MinLength } from 'class-validator';
import { ContactPreference } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.module';
import { Roles } from '../../common/guards';

class CreateTenantDto {
  @IsString() @MinLength(2) name: string;
  @Matches(/^[a-z0-9-]{3,40}$/, { message: 'slug: 3-40 caracteres a-z, 0-9 o guion' }) slug: string;
  @IsString() @MinLength(2) adminName: string;
  @IsEmail() adminEmail: string;
  @IsString() @MinLength(8) adminPassword: string;
  @IsOptional() @IsNumber() @Min(0) @Max(100) taxRate?: number;
  @IsOptional() @IsString() @Length(3, 3) currency?: string;
  @IsOptional() @IsString() plan?: string;
  @IsOptional() @IsInt() @Min(1) @Max(1000) maxUsers?: number;
  @IsOptional() @IsBoolean() seedServices?: boolean;
}

class UpdateTenantDto {
  @IsOptional() @IsString() @MinLength(2) name?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsString() plan?: string;
  @IsOptional() @IsInt() @Min(1) @Max(1000) maxUsers?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) taxRate?: number;
  @IsOptional() @IsString() @Length(3, 3) currency?: string;
}

class PlatformUserDto {
  @IsUUID() tenantId: string;
  @IsEmail() email: string;
  @IsString() @MinLength(2) fullName: string;
  @IsString() @MinLength(8) password: string;
  @IsString() role: string;
}
class PlatformUserUpdateDto {
  @IsOptional() @IsUUID() tenantId?: string;
  @IsOptional() @IsString() @MinLength(2) fullName?: string;
  @IsOptional() @IsString() @MinLength(8) password?: string;
  @IsOptional() @IsString() role?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
class PlatformClientDto {
  @IsUUID() tenantId: string;
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsEnum(ContactPreference) contactPreference?: ContactPreference;
}
class PlatformClientUpdateDto {
  @IsOptional() @IsUUID() tenantId?: string;
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsEnum(ContactPreference) contactPreference?: ContactPreference;
}

const DEFAULT_SERVICES: [string, string, number][] = [
  ['Lavado Básico', 'Exterior y enjuague', 120],
  ['Lavado Premium', 'Exterior, interior y llantas', 220],
  ['Aspirado', 'Aspirado completo interior', 60],
];

@Injectable()
export class PlatformService {
  constructor(private prisma: PrismaService) {}

  async list() {
    const tenants = await this.prisma.tenant.findMany({
      where: { deletedAt: null, slug: { not: 'platform' } },
      include: { _count: { select: { users: { where: { deletedAt: null } } } } },
      orderBy: { createdAt: 'desc' },
    });
    const since = new Date(Date.now() - 30 * 86_400_000);
    const [totals, recent] = await Promise.all([
      this.prisma.washOrder.groupBy({ by: ['tenantId'], where: { deletedAt: null }, _count: true, _max: { receivedAt: true } }),
      this.prisma.washOrder.groupBy({ by: ['tenantId'], where: { deletedAt: null, receivedAt: { gte: since } }, _count: true, _sum: { total: true } }),
    ]);
    return tenants.map((t) => {
      const all = totals.find((x) => x.tenantId === t.id);
      const r = recent.find((x) => x.tenantId === t.id);
      return {
        id: t.id, name: t.name, slug: t.slug, isActive: t.isActive, plan: t.plan, maxUsers: t.maxUsers,
        taxRate: Number(t.taxRate), currency: t.currency, createdAt: t.createdAt, logoUrl: t.logoPath ? `/api/uploads/${t.logoPath}` : null,
        users: t._count.users, orders: all?._count ?? 0, lastOrderAt: all?._max.receivedAt ?? null,
        orders30d: r?._count ?? 0, sales30d: Number(r?._sum.total ?? 0),
      };
    });
  }

  async create(dto: CreateTenantDto) {
    if (dto.slug === 'platform' || (await this.prisma.tenant.findUnique({ where: { slug: dto.slug } }))) {
      throw new ConflictException('El identificador ya existe');
    }
    const role = await this.prisma.role.findUniqueOrThrow({ where: { name: 'ADMIN' } });
    const t = await this.prisma.tenant.create({
      data: {
        name: dto.name, slug: dto.slug, taxRate: dto.taxRate ?? 16, currency: (dto.currency ?? 'MXN').toUpperCase(),
        plan: dto.plan ?? 'free', maxUsers: dto.maxUsers ?? 10,
        users: { create: { roleId: role.id, email: dto.adminEmail.toLowerCase().trim(), fullName: dto.adminName, passwordHash: await bcrypt.hash(dto.adminPassword, 10) } },
        ...(dto.seedServices !== false ? { services: { create: DEFAULT_SERVICES.map(([name, description, price]) => ({ name, description, price })) } } : {}),
      },
    });
    return { id: t.id, slug: t.slug, name: t.name };
  }

  async update(id: string, dto: UpdateTenantDto) {
    const t = await this.prisma.tenant.findFirst({ where: { id, deletedAt: null, slug: { not: 'platform' } } });
    if (!t) throw new NotFoundException();
    if (dto.maxUsers != null) {
      const used = await this.prisma.user.count({ where: { tenantId: id, deletedAt: null } });
      if (dto.maxUsers < used) throw new BadRequestException(`La empresa ya tiene ${used} usuarios`);
    }
    return this.prisma.tenant.update({ where: { id }, data: { ...dto, currency: dto.currency?.toUpperCase() } });
  }

  /** Baja logica: se suspende y se oculta; los datos se conservan. */
  async remove(id: string) {
    const r = await this.prisma.tenant.updateMany({ where: { id, deletedAt: null, slug: { not: 'platform' } }, data: { deletedAt: new Date(), isActive: false } });
    if (!r.count) throw new NotFoundException();
    return { ok: true };
  }
}

@ApiTags('platform')
@ApiBearerAuth()
@Roles('SUPERADMIN')
@Controller('platform/tenants')
export class PlatformController {
  constructor(private svc: PlatformService) {}
  @Get() list() { return this.svc.list(); }
  @Post() create(@Body() dto: CreateTenantDto) { return this.svc.create(dto); }
  @Patch(':id') update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTenantDto) { return this.svc.update(id, dto); }
  @Delete(':id') remove(@Param('id', ParseUUIDPipe) id: string) { return this.svc.remove(id); }
}

/** Vista y administracion global (solo SUPERADMIN): usuarios, clientes y ordenes de TODAS las empresas. */
@Injectable()
export class PlatformDirectoryService {
  constructor(private prisma: PrismaService) {}

  private realTenant = { deletedAt: null, slug: { not: 'platform' } } as const;

  private async assertTenant(id: string) {
    const t = await this.prisma.tenant.findFirst({ where: { id, isActive: true, ...this.realTenant } });
    if (!t) throw new BadRequestException('Empresa inválida o suspendida');
    return t;
  }

  private async assertRoom(tenantId: string, maxUsers: number) {
    const used = await this.prisma.user.count({ where: { tenantId, deletedAt: null } });
    if (used >= maxUsers) throw new BadRequestException(`La empresa alcanzó su límite de ${maxUsers} usuarios`);
  }

  // ---------- usuarios ----------
  users(tenantId?: string) {
    return this.prisma.user.findMany({
      where: { deletedAt: null, ...(tenantId ? { tenantId } : {}), tenant: this.realTenant, role: { name: { not: 'SUPERADMIN' } } },
      select: { id: true, email: true, fullName: true, isActive: true, createdAt: true, role: { select: { name: true, label: true } }, tenant: { select: { id: true, name: true, slug: true } } },
      orderBy: [{ tenant: { name: 'asc' } }, { fullName: 'asc' }],
    });
  }

  async createUser(dto: PlatformUserDto) {
    const tenant = await this.assertTenant(dto.tenantId);
    const email = dto.email.toLowerCase().trim();
    if (await this.prisma.user.findFirst({ where: { tenantId: tenant.id, email, deletedAt: null } })) throw new ConflictException('Ese correo ya existe en la empresa');
    await this.assertRoom(tenant.id, tenant.maxUsers);
    const role = await this.prisma.role.findUnique({ where: { name: dto.role } });
    if (!role || role.name === 'SUPERADMIN') throw new BadRequestException('Rol inválido');
    const u = await this.prisma.user.create({
      data: { tenantId: tenant.id, roleId: role.id, email, fullName: dto.fullName, passwordHash: await bcrypt.hash(dto.password, 10) },
      select: { id: true, email: true, fullName: true },
    });
    return { ...u, tenant: tenant.name };
  }

  async updateUser(id: string, dto: PlatformUserUpdateDto) {
    const u = await this.prisma.user.findFirst({ where: { id, deletedAt: null, tenant: this.realTenant, role: { name: { not: 'SUPERADMIN' } } } });
    if (!u) throw new NotFoundException();
    let tenantId = u.tenantId;
    if (dto.tenantId && dto.tenantId !== u.tenantId) {
      const target = await this.assertTenant(dto.tenantId);
      if (await this.prisma.washOrder.count({ where: { assignedToId: id } })) throw new BadRequestException('El usuario tiene órdenes asignadas; no se puede mover de empresa');
      if (await this.prisma.user.findFirst({ where: { tenantId: target.id, email: u.email, deletedAt: null } })) throw new ConflictException('Ese correo ya existe en la empresa destino');
      await this.assertRoom(target.id, target.maxUsers);
      tenantId = target.id;
    }
    const role = dto.role ? await this.prisma.role.findUnique({ where: { name: dto.role } }) : null;
    if (dto.role && (!role || role.name === 'SUPERADMIN')) throw new BadRequestException('Rol inválido');
    await this.prisma.user.update({
      where: { id },
      data: { tenantId, fullName: dto.fullName, isActive: dto.isActive, roleId: role?.id, ...(dto.password ? { passwordHash: await bcrypt.hash(dto.password, 10) } : {}) },
    });
    return { ok: true };
  }

  async removeUser(id: string) {
    const r = await this.prisma.user.updateMany({ where: { id, deletedAt: null, tenant: this.realTenant, role: { name: { not: 'SUPERADMIN' } } }, data: { deletedAt: new Date(), isActive: false } });
    if (!r.count) throw new NotFoundException();
    return { ok: true };
  }

  // ---------- clientes ----------
  clients(tenantId?: string, search?: string) {
    return this.prisma.client.findMany({
      where: {
        deletedAt: null, tenant: this.realTenant, ...(tenantId ? { tenantId } : {}),
        ...(search ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { phone: { contains: search } }, { email: { contains: search, mode: 'insensitive' } }] } : {}),
      },
      include: { tenant: { select: { id: true, name: true, slug: true } }, vehicles: { where: { deletedAt: null }, select: { id: true, plate: true, brand: true, model: true } }, _count: { select: { orders: true } } },
      orderBy: [{ tenant: { name: 'asc' } }, { createdAt: 'desc' }],
      take: 300,
    });
  }

  async createClient(dto: PlatformClientDto) {
    const tenant = await this.assertTenant(dto.tenantId);
    const { tenantId, ...rest } = dto;
    return this.prisma.client.create({ data: { ...rest, tenantId: tenant.id } });
  }

  async updateClient(id: string, dto: PlatformClientUpdateDto) {
    const c = await this.prisma.client.findFirst({ where: { id, deletedAt: null, tenant: this.realTenant }, include: { _count: { select: { orders: true, vehicles: true } } } });
    if (!c) throw new NotFoundException();
    const { tenantId, ...rest } = dto;
    let target = c.tenantId;
    if (tenantId && tenantId !== c.tenantId) {
      await this.assertTenant(tenantId);
      if (c._count.orders || c._count.vehicles) throw new BadRequestException('El cliente tiene órdenes o vehículos; no se puede mover de empresa');
      target = tenantId;
    }
    await this.prisma.client.update({ where: { id }, data: { ...rest, tenantId: target } });
    return { ok: true };
  }

  async removeClient(id: string) {
    const r = await this.prisma.client.updateMany({ where: { id, deletedAt: null, tenant: this.realTenant }, data: { deletedAt: new Date() } });
    if (!r.count) throw new NotFoundException();
    return { ok: true };
  }

  // ---------- ordenes (solo lectura) ----------
  async orders(tenantId?: string, search?: string, status?: string) {
    const s = search?.trim();
    const rows = await this.prisma.washOrder.findMany({
      where: {
        deletedAt: null, tenant: this.realTenant, ...(tenantId ? { tenantId } : {}), ...(status ? { status: status as any } : {}),
        ...(s ? { OR: [{ folio: { contains: s, mode: 'insensitive' } }, { code: { contains: s.toUpperCase() } }, { vehicle: { plate: { contains: s.toUpperCase().replace(/[^A-Z0-9]/g, '') || s } } }, { client: { name: { contains: s, mode: 'insensitive' } } }] } : {}),
      },
      include: { tenant: { select: { id: true, name: true, slug: true, currency: true } }, vehicle: true, client: { select: { name: true } }, assignedTo: { select: { fullName: true } } },
      orderBy: { receivedAt: 'desc' },
      take: 200,
    });
    return rows.map((o) => (o.vehicle ? o : { ...o, vehicle: { plate: '', brand: '', model: '', color: '' } }));
  }
}

@ApiTags('platform')
@ApiBearerAuth()
@Roles('SUPERADMIN')
@Controller('platform')
export class PlatformDirectoryController {
  constructor(private svc: PlatformDirectoryService) {}
  @Get('users') users(@Query('tenantId') t?: string) { return this.svc.users(t); }
  @Post('users') createUser(@Body() dto: PlatformUserDto) { return this.svc.createUser(dto); }
  @Patch('users/:id') updateUser(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PlatformUserUpdateDto) { return this.svc.updateUser(id, dto); }
  @Delete('users/:id') removeUser(@Param('id', ParseUUIDPipe) id: string) { return this.svc.removeUser(id); }

  @Get('clients') clients(@Query('tenantId') t?: string, @Query('search') s?: string) { return this.svc.clients(t, s); }
  @Post('clients') createClient(@Body() dto: PlatformClientDto) { return this.svc.createClient(dto); }
  @Patch('clients/:id') updateClient(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PlatformClientUpdateDto) { return this.svc.updateClient(id, dto); }
  @Delete('clients/:id') removeClient(@Param('id', ParseUUIDPipe) id: string) { return this.svc.removeClient(id); }

  @Get('orders') orders(@Query('tenantId') t?: string, @Query('search') s?: string, @Query('status') st?: string) { return this.svc.orders(t, s, st); }
}

@Module({
  controllers: [PlatformController, PlatformDirectoryController],
  providers: [PlatformService, PlatformDirectoryService],
})
export class PlatformModule {}
