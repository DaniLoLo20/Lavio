import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsNumber, IsOptional, IsString, IsUUID, Min, MinLength } from 'class-validator';
import { MovementType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.module';
import { AuthUser, CurrentUser, Perms, PermsAny, Roles } from '../../common/guards';

class ProductDto {
  @IsString() @MinLength(1) sku: string;
  @IsString() @MinLength(2) name: string;
  @IsString() @MinLength(2) category: string;
  @IsNumber() @Min(0) stock: number;
  @IsNumber() @Min(0) minStock: number;
  @IsNumber() @Min(0) cost: number;
  @IsOptional() @IsUUID() supplierId?: string;
}
class UpdateProductDto {
  @IsOptional() @IsString() @MinLength(1) sku?: string;
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsNumber() @Min(0) minStock?: number;
  @IsOptional() @IsNumber() @Min(0) cost?: number;
  @IsOptional() @IsUUID() supplierId?: string;
}
class MovementDto {
  @IsUUID() productId: string;
  @IsEnum(MovementType) type: MovementType;
  @IsNumber() quantity: number; // IN/OUT > 0; ADJUSTMENT con signo
  @IsOptional() @IsString() reason?: string;
}

@Injectable()
export class InventoryService {
  constructor(private prisma: PrismaService) {}

  products(tenantId: string, lowOnly: boolean) {
    return this.prisma.inventoryProduct
      .findMany({ where: { tenantId, deletedAt: null }, include: { supplier: { select: { id: true, name: true } } }, orderBy: { name: 'asc' } })
      .then((rows) => (lowOnly ? rows.filter((p) => Number(p.stock) <= Number(p.minStock)) : rows));
  }

  async createProduct(u: AuthUser, dto: ProductDto) {
    if (await this.prisma.inventoryProduct.findFirst({ where: { tenantId: u.tenantId, sku: dto.sku } })) {
      throw new ConflictException('El SKU ya existe');
    }
    return this.prisma.$transaction(async (tx) => {
      const p = await tx.inventoryProduct.create({ data: { ...dto, tenantId: u.tenantId, createdById: u.sub } });
      if (dto.stock > 0) {
        await tx.inventoryMovement.create({ data: { tenantId: u.tenantId, productId: p.id, type: 'IN', quantity: dto.stock, reason: 'Existencia inicial', createdById: u.sub } });
      }
      return p;
    });
  }

  async updateProduct(u: AuthUser, id: string, dto: UpdateProductDto) {
    if (dto.sku && (await this.prisma.inventoryProduct.findFirst({ where: { tenantId: u.tenantId, sku: dto.sku, id: { not: id }, deletedAt: null } }))) throw new ConflictException('El SKU ya existe');
    const r = await this.prisma.inventoryProduct.updateMany({ where: { id, tenantId: u.tenantId, deletedAt: null }, data: { ...dto, updatedById: u.sub } });
    if (!r.count) throw new NotFoundException();
    return this.prisma.inventoryProduct.findUnique({ where: { id } });
  }

  async removeProduct(u: AuthUser, id: string) {
    const r = await this.prisma.inventoryProduct.updateMany({ where: { id, tenantId: u.tenantId, deletedAt: null }, data: { deletedAt: new Date(), updatedById: u.sub } });
    if (!r.count) throw new NotFoundException();
    return { ok: true };
  }

  async move(u: AuthUser, dto: MovementDto) {
    if (dto.type !== 'ADJUSTMENT' && dto.quantity <= 0) throw new BadRequestException('La cantidad debe ser mayor a 0');
    if (dto.type === 'ADJUSTMENT' && dto.quantity === 0) throw new BadRequestException('El ajuste no puede ser 0');
    const delta = dto.type === 'OUT' ? -dto.quantity : dto.quantity;
    return this.prisma.$transaction(async (tx) => {
      const p = await tx.inventoryProduct.findFirst({ where: { id: dto.productId, tenantId: u.tenantId, deletedAt: null } });
      if (!p) throw new NotFoundException('Producto no encontrado');
      if (Number(p.stock) + delta < 0) throw new BadRequestException('Existencia insuficiente');
      await tx.inventoryProduct.update({ where: { id: p.id }, data: { stock: { increment: delta }, updatedById: u.sub } });
      return tx.inventoryMovement.create({
        data: { tenantId: u.tenantId, productId: p.id, type: dto.type, quantity: dto.quantity, reason: dto.reason, createdById: u.sub },
      });
    });
  }

  movements(tenantId: string, productId?: string) {
    return this.prisma.inventoryMovement.findMany({
      where: { tenantId, ...(productId ? { productId } : {}) },
      include: { product: { select: { name: true, sku: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
}

@ApiTags('inventory')
@ApiBearerAuth()
@Controller('inventory')
export class InventoryController {
  constructor(private svc: InventoryService) {}
  @PermsAny('inventory:view', 'purchases:view', 'purchases:create') @Get('products') products(@CurrentUser() u: AuthUser, @Query('low') low?: string) { return this.svc.products(u.tenantId, low === 'true'); }
  @Perms('inventory:create') @Post('products') create(@CurrentUser() u: AuthUser, @Body() dto: ProductDto) { return this.svc.createProduct(u, dto); }
  @Perms('inventory:edit') @Patch('products/:id') update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProductDto) { return this.svc.updateProduct(u, id, dto); }
  @Perms('inventory:delete') @Delete('products/:id') remove(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.removeProduct(u, id); }
  @Perms('inventory:adjust') @Post('movements') move(@CurrentUser() u: AuthUser, @Body() dto: MovementDto) { return this.svc.move(u, dto); }
  @Perms('inventory:view') @Get('movements') movements(@CurrentUser() u: AuthUser, @Query('productId') p?: string) { return this.svc.movements(u.tenantId, p); }
}

@Module({ controllers: [InventoryController], providers: [InventoryService] })
export class InventoryModule {}
