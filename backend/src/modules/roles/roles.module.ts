import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Injectable, Module, NotFoundException, OnModuleInit, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { PrismaService } from '../../prisma/prisma.module';
import { Roles } from '../../common/guards';
import { ADMIN_PERMS, ALL_TENANT_PERMS, CATALOG, WASHER_DEFAULT_PERMS, isValidPerm } from '../../common/permissions';

const RESERVED = ['ADMIN', 'WASHER', 'SUPERADMIN'];

class CreateRoleDto {
  @IsString() @MinLength(2) @MaxLength(40) @Matches(/^[\p{L}\p{N} ._-]+$/u, { message: 'name: solo letras, números, espacios, punto, guion y guion bajo' }) name: string;
  @IsOptional() @IsString() @MaxLength(200) description?: string;
  @IsArray() @ArrayUnique() @IsString({ each: true }) permissions: string[];
}
class UpdateRoleDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(40) @Matches(/^[\p{L}\p{N} ._-]+$/u) label?: string;
  @IsOptional() @IsString() @MaxLength(200) description?: string;
  @IsOptional() @IsArray() @ArrayUnique() @IsString({ each: true }) permissions?: string[];
}

@Injectable()
export class RolesService implements OnModuleInit {
  constructor(private prisma: PrismaService) {}

  /** Asegura los roles del sistema. El administrador SIEMPRE tiene todos los permisos (incluye los nuevos al actualizar). */
  async onModuleInit() {
    const sys = async (name: string, label: string, description: string, perms: string[], force: boolean) => {
      const r = await this.prisma.role.findUnique({ where: { name } });
      if (!r) return this.prisma.role.create({ data: { name, label, description, isSystem: true, permissions: perms } });
      await this.prisma.role.update({
        where: { name },
        data: { label: r.label ?? label, isSystem: true, description: r.description ?? description, ...(force || r.permissions.length === 0 ? { permissions: perms } : {}) },
      });
    };
    await sys('ADMIN', 'Administrador', 'Acceso completo a su empresa', ADMIN_PERMS, true);
    await sys('WASHER', 'Lavador', 'Trabaja las órdenes que le asignan', WASHER_DEFAULT_PERMS, false);
    await sys('SUPERADMIN', 'Superadministrador', 'Administra la plataforma y los roles', [], true);
  }

  catalog() {
    return CATALOG;
  }

  private view(r: any) {
    return { id: r.id, name: r.name, label: r.label ?? r.name, description: r.description, isSystem: r.isSystem, permissions: r.permissions, users: r._count?.users ?? 0 };
  }

  async list() {
    const rows = await this.prisma.role.findMany({ include: { _count: { select: { users: { where: { deletedAt: null } } } } }, orderBy: [{ isSystem: 'desc' }, { name: 'asc' }] });
    return rows.map((r) => this.view(r));
  }

  private validatePerms(perms: string[]) {
    const bad = perms.filter((p) => !isValidPerm(p));
    if (bad.length) throw new BadRequestException(`Permisos inválidos: ${bad.join(', ')}`);
  }

  async create(dto: CreateRoleDto) {
    const name = dto.name.trim();
    if (RESERVED.includes(name.toUpperCase())) throw new BadRequestException('Ese nombre está reservado');
    if (await this.prisma.role.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } })) throw new ConflictException('Ya existe un rol con ese nombre');
    this.validatePerms(dto.permissions);
    const r = await this.prisma.role.create({ data: { name, label: name, description: dto.description, permissions: dto.permissions }, include: { _count: { select: { users: true } } } });
    return this.view(r);
  }

  async update(id: string, dto: UpdateRoleDto) {
    const r = await this.prisma.role.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Rol no encontrado');
    if (r.name === 'ADMIN' || r.name === 'SUPERADMIN') throw new BadRequestException('Este rol del sistema no se puede modificar: el Administrador siempre tiene todos los permisos');
    if (dto.permissions) this.validatePerms(dto.permissions);
    if (dto.label && !r.isSystem && dto.label.toLowerCase() !== r.name.toLowerCase()) {
      // renombrar = cambiar el nombre (identidad) del rol
      if (RESERVED.includes(dto.label.toUpperCase())) throw new BadRequestException('Ese nombre está reservado');
      if (await this.prisma.role.findFirst({ where: { id: { not: id }, name: { equals: dto.label, mode: 'insensitive' } } })) throw new ConflictException('Ya existe un rol con ese nombre');
    }
    const upd = await this.prisma.role.update({
      where: { id },
      data: { description: dto.description, permissions: dto.permissions, ...(dto.label ? { label: dto.label, ...(r.isSystem ? {} : { name: dto.label }) } : {}) },
      include: { _count: { select: { users: { where: { deletedAt: null } } } } },
    });
    return this.view(upd);
  }

  async remove(id: string) {
    const r = await this.prisma.role.findUnique({ where: { id }, include: { _count: { select: { users: { where: { deletedAt: null } } } } } });
    if (!r) throw new NotFoundException('Rol no encontrado');
    if (r.isSystem) throw new BadRequestException('Los roles del sistema no se pueden eliminar');
    if (r._count.users > 0) throw new ConflictException(`Hay ${r._count.users} usuario(s) con este rol. Cámbieles el rol antes de eliminarlo.`);
    // Los usuarios eliminados (baja lógica) conservan la referencia al rol: pasan al rol de menor privilegio para poder borrarlo
    const fallback = await this.prisma.role.findUniqueOrThrow({ where: { name: 'WASHER' } });
    await this.prisma.$transaction([
      this.prisma.user.updateMany({ where: { roleId: id, deletedAt: { not: null } }, data: { roleId: fallback.id } }),
      this.prisma.role.delete({ where: { id } }),
    ]);
    return { ok: true };
  }
}

/** Gestor de roles y permisos: solo el superadmin de plataforma. */
@ApiTags('roles')
@ApiBearerAuth()
@Roles('SUPERADMIN')
@Controller('platform/roles')
export class RolesController {
  constructor(private svc: RolesService) {}
  @Get() list() { return this.svc.list(); }
  @Get('catalog') catalog() { return { resources: this.svc.catalog(), all: ALL_TENANT_PERMS }; }
  @Post() create(@Body() dto: CreateRoleDto) { return this.svc.create(dto); }
  @Patch(':id') update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRoleDto) { return this.svc.update(id, dto); }
  @Delete(':id') remove(@Param('id', ParseUUIDPipe) id: string) { return this.svc.remove(id); }
}

@Module({ controllers: [RolesController], providers: [RolesService], exports: [RolesService] })
export class RolesModule {}
