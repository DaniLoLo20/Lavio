import { Body, Controller, Delete, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';
import { PrismaService } from '../../prisma/prisma.module';
import { AuthUser, CurrentUser, Perms, PermsAny, Roles } from '../../common/guards';

class SupplierDto {
  @IsString() @MinLength(2) name: string;
  @IsOptional() @IsString() contactName?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() taxId?: string;
  @IsOptional() @IsString() notes?: string;
}
class UpdateSupplierDto {
  @IsOptional() @IsString() @MinLength(2) name?: string;
  @IsOptional() @IsString() contactName?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() email?: string; // '' limpia el valor
  @IsOptional() @IsString() taxId?: string;
  @IsOptional() @IsString() notes?: string;
}

@Injectable()
export class SuppliersService {
  constructor(private prisma: PrismaService) {}

  list(tenantId: string) {
    return this.prisma.supplier.findMany({
      where: { tenantId, deletedAt: null },
      include: { _count: { select: { products: true, purchases: true } } },
      orderBy: { name: 'asc' },
    });
  }

  create(u: AuthUser, dto: SupplierDto) {
    return this.prisma.supplier.create({ data: { ...dto, tenantId: u.tenantId } });
  }

  async update(u: AuthUser, id: string, dto: UpdateSupplierDto) {
    const r = await this.prisma.supplier.updateMany({ where: { id, tenantId: u.tenantId, deletedAt: null }, data: dto });
    if (!r.count) throw new NotFoundException();
    return this.prisma.supplier.findUnique({ where: { id } });
  }

  async remove(u: AuthUser, id: string) {
    const r = await this.prisma.supplier.updateMany({ where: { id, tenantId: u.tenantId, deletedAt: null }, data: { deletedAt: new Date() } });
    if (!r.count) throw new NotFoundException();
    return { ok: true };
  }
}

@ApiTags('suppliers')
@ApiBearerAuth()
@Controller('suppliers')
export class SuppliersController {
  constructor(private svc: SuppliersService) {}
  @PermsAny('suppliers:view', 'inventory:view', 'purchases:create') @Get() list(@CurrentUser() u: AuthUser) { return this.svc.list(u.tenantId); }
  @Perms('suppliers:create') @Post() create(@CurrentUser() u: AuthUser, @Body() dto: SupplierDto) { return this.svc.create(u, dto); }
  @Perms('suppliers:edit') @Patch(':id') update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSupplierDto) { return this.svc.update(u, id, dto); }
  @Perms('suppliers:delete') @Delete(':id') remove(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.remove(u, id); }
}

@Module({ controllers: [SuppliersController], providers: [SuppliersService] })
export class SuppliersModule {}
