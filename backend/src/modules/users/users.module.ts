import { BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsOptional, IsString, MinLength } from 'class-validator';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.module';
import { AuthUser, CurrentUser, Perms, PermsAny } from '../../common/guards';

class CreateUserDto {
  @IsEmail() email: string;
  @IsString() @MinLength(2) fullName: string;
  @IsString() @MinLength(8) password: string;
  /** Nombre del rol (Administrador = ADMIN, Lavador = WASHER o uno creado por el superadmin) */
  @IsString() role: string;
}
class UpdateUserDto {
  @IsOptional() @IsString() @MinLength(2) fullName?: string;
  @IsOptional() @IsString() @MinLength(8) password?: string;
  @IsOptional() @IsString() role?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

const SELECT = {
  id: true, email: true, fullName: true, isActive: true, createdAt: true,
  role: { select: { name: true, label: true } },
} as const;

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  list(tenantId: string, filter?: { washers?: boolean }) {
    return this.prisma.user.findMany({
      where: { tenantId, deletedAt: null, ...(filter?.washers ? { role: { permissions: { has: 'orders:own_only' } } } : {}) },
      select: SELECT,
      orderBy: { fullName: 'asc' },
    });
  }

  /** Nadie puede dar (ni tocar a quien tenga) un rol con mas permisos que los propios: evita escalar privilegios. */
  private within(auth: AuthUser, perms: string[]) {
    const mine = new Set(auth.perms ?? []);
    return perms.every((p) => mine.has(p));
  }

  /** Roles que el usuario actual puede asignar (nunca el de superadmin). */
  async assignableRoles(auth: AuthUser) {
    const roles = await this.prisma.role.findMany({ where: { name: { not: 'SUPERADMIN' } }, orderBy: [{ isSystem: 'desc' }, { name: 'asc' }] });
    return roles.filter((r) => this.within(auth, r.permissions)).map((r) => ({ name: r.name, label: r.label ?? r.name, description: r.description, isSystem: r.isSystem, permissions: r.permissions.length }));
  }

  private async roleFor(auth: AuthUser, name: string) {
    const role = await this.prisma.role.findUnique({ where: { name } });
    if (!role || role.name === 'SUPERADMIN') throw new BadRequestException('Rol inválido');
    if (!this.within(auth, role.permissions)) throw new ForbiddenException('No puedes asignar un rol con más permisos que los tuyos');
    return role;
  }

  async create(auth: AuthUser, dto: CreateUserDto) {
    const email = dto.email.toLowerCase().trim();
    if (await this.prisma.user.findFirst({ where: { tenantId: auth.tenantId, email, deletedAt: null } })) {
      throw new ConflictException('El correo ya está registrado');
    }
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: auth.tenantId }, select: { maxUsers: true } });
    const used = await this.prisma.user.count({ where: { tenantId: auth.tenantId, deletedAt: null } });
    if (used >= tenant.maxUsers) throw new BadRequestException(`Se alcanzó el límite de ${tenant.maxUsers} usuarios de su plan`);
    const role = await this.roleFor(auth, dto.role);
    return this.prisma.user.create({
      data: {
        tenantId: auth.tenantId, roleId: role.id, email, fullName: dto.fullName,
        passwordHash: await bcrypt.hash(dto.password, 10), createdById: auth.sub,
      },
      select: SELECT,
    });
  }

  private async target(auth: AuthUser, id: string) {
    const u = await this.prisma.user.findFirst({ where: { id, tenantId: auth.tenantId, deletedAt: null }, include: { role: true } });
    if (!u) throw new NotFoundException();
    if (!this.within(auth, u.role.permissions)) throw new ForbiddenException('No puedes modificar a un usuario con más permisos que los tuyos');
    return u;
  }

  async update(auth: AuthUser, id: string, dto: UpdateUserDto) {
    const u = await this.target(auth, id);
    if (id === auth.sub && (dto.isActive === false || (dto.role && dto.role !== u.role.name))) {
      throw new BadRequestException('No puedes desactivarte ni cambiar tu propio rol');
    }
    const role = dto.role ? await this.roleFor(auth, dto.role) : null;
    return this.prisma.user.update({
      where: { id },
      data: {
        fullName: dto.fullName, isActive: dto.isActive, roleId: role?.id, updatedById: auth.sub,
        ...(dto.password ? { passwordHash: await bcrypt.hash(dto.password, 10) } : {}),
      },
      select: SELECT,
    });
  }

  async remove(auth: AuthUser, id: string) {
    if (id === auth.sub) throw new BadRequestException('No puedes eliminarte a ti mismo');
    await this.target(auth, id);
    await this.prisma.user.update({ where: { id }, data: { deletedAt: new Date(), isActive: false, updatedById: auth.sub } });
    return { ok: true };
  }
}

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private svc: UsersService) {}
  @Perms('users:view') @Get() list(@CurrentUser() u: AuthUser) { return this.svc.list(u.tenantId); }
  /** Usuarios que trabajan órdenes asignadas (para elegirlos al crear/asignar una orden). */
  @PermsAny('users:view', 'orders:assign', 'orders:create') @Get('washers') washers(@CurrentUser() u: AuthUser) { return this.svc.list(u.tenantId, { washers: true }); }
  @PermsAny('users:create', 'users:edit') @Get('roles') roles(@CurrentUser() u: AuthUser) { return this.svc.assignableRoles(u); }
  @Perms('users:create') @Post() create(@CurrentUser() u: AuthUser, @Body() dto: CreateUserDto) { return this.svc.create(u, dto); }
  @Perms('users:edit') @Patch(':id') update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto) { return this.svc.update(u, id, dto); }
  @Perms('users:delete') @Delete(':id') remove(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.remove(u, id); }
}

@Module({ controllers: [UsersController], providers: [UsersService] })
export class UsersModule {}
