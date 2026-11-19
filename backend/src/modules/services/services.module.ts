import { Body, Controller, Delete, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { PrismaService } from '../../prisma/prisma.module';
import { AuthUser, CurrentUser, Perms, PermsAny, Roles } from '../../common/guards';

class CreateServiceDto {
  @IsString() @MinLength(2) name: string;
  @IsOptional() @IsString() description?: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) price: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
class UpdateServiceDto {
  @IsOptional() @IsString() @MinLength(2) name?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) price?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

@Injectable()
export class ServicesService {
  constructor(private prisma: PrismaService) {}
  list(tenantId: string, onlyActive: boolean) {
    return this.prisma.service.findMany({
      where: { tenantId, deletedAt: null, ...(onlyActive ? { isActive: true } : {}) },
      orderBy: { name: 'asc' },
    });
  }
  create(u: AuthUser, dto: CreateServiceDto) {
    return this.prisma.service.create({ data: { ...dto, tenantId: u.tenantId, createdById: u.sub } });
  }
  async update(u: AuthUser, id: string, dto: UpdateServiceDto) {
    const r = await this.prisma.service.updateMany({ where: { id, tenantId: u.tenantId, deletedAt: null }, data: { ...dto, updatedById: u.sub } });
    if (!r.count) throw new NotFoundException();
    return this.prisma.service.findUnique({ where: { id } });
  }
  async remove(u: AuthUser, id: string) {
    const r = await this.prisma.service.updateMany({ where: { id, tenantId: u.tenantId, deletedAt: null }, data: { deletedAt: new Date(), isActive: false, updatedById: u.sub } });
    if (!r.count) throw new NotFoundException();
    return { ok: true };
  }
}

@ApiTags('services')
@ApiBearerAuth()
@Controller('services')
export class ServicesController {
  constructor(private svc: ServicesService) {}
  @PermsAny('services:view', 'orders:create') @Get() list(@CurrentUser() u: AuthUser, @Query('active') a?: string) { return this.svc.list(u.tenantId, a === 'true'); }
  @Perms('services:create') @Post() create(@CurrentUser() u: AuthUser, @Body() dto: CreateServiceDto) { return this.svc.create(u, dto); }
  @Perms('services:edit') @Patch(':id') update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateServiceDto) { return this.svc.update(u, id, dto); }
  @Perms('services:delete') @Delete(':id') remove(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.remove(u, id); }
}

@Module({ controllers: [ServicesController], providers: [ServicesService] })
export class ServicesModule {}
