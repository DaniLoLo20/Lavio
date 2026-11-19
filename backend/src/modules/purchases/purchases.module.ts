import { BadRequestException, Body, Controller, Get, Injectable, Module, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsDateString, IsEnum, IsNumber, IsOptional, IsString, IsUUID, Min, ValidateNested } from 'class-validator';
import { PaymentMethod } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.module';
import { AuthUser, CurrentUser, Perms, PermsAny, Roles } from '../../common/guards';

class PurchaseItemDto {
  @IsUUID() productId: string;
  @IsNumber() @Min(0.001) quantity: number;
  @IsNumber() @Min(0) unitCost: number;
}
class PurchaseExpenseDto {
  @IsEnum(PaymentMethod) method: PaymentMethod;
}
class PurchaseDto {
  /** Si viene, registra tambien el egreso (categoria Compras) en la caja abierta. */
  @IsOptional() @ValidateNested() @Type(() => PurchaseExpenseDto) expense?: PurchaseExpenseDto;
  @IsUUID() supplierId: string;
  @IsDateString() date: string;
  @IsOptional() @IsString() notes?: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => PurchaseItemDto) items: PurchaseItemDto[];
}

@Injectable()
export class PurchasesService {
  constructor(private prisma: PrismaService) {}

  list(tenantId: string) {
    return this.prisma.purchase.findMany({
      where: { tenantId, deletedAt: null },
      include: { supplier: { select: { name: true } }, items: { include: { product: { select: { name: true, sku: true } } } } },
      orderBy: { date: 'desc' },
      take: 100,
    });
  }

  /** Registra la compra y actualiza existencias + costo + movimientos IN en una sola transaccion. */
  create(u: AuthUser, dto: PurchaseDto) {
    return this.prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.findFirst({ where: { id: dto.supplierId, tenantId: u.tenantId, deletedAt: null } });
      if (!supplier) throw new BadRequestException('Proveedor inválido');
      const ids = [...new Set(dto.items.map((i) => i.productId))];
      const count = await tx.inventoryProduct.count({ where: { id: { in: ids }, tenantId: u.tenantId, deletedAt: null } });
      if (count !== ids.length) throw new BadRequestException('Algún producto no existe');

      const lines = dto.items.map((i) => ({ ...i, total: Math.round(i.quantity * i.unitCost * 100) / 100 }));
      const purchase = await tx.purchase.create({
        data: {
          tenantId: u.tenantId, supplierId: dto.supplierId, date: new Date(dto.date), notes: dto.notes, createdById: u.sub,
          total: lines.reduce((s, l) => s + l.total, 0),
          items: { create: lines.map((l) => ({ tenantId: u.tenantId, productId: l.productId, quantity: l.quantity, unitCost: l.unitCost, total: l.total })) },
        },
        include: { items: true },
      });
      if (dto.expense) {
        const session = await tx.cashSession.findFirst({ where: { tenantId: u.tenantId, status: 'OPEN' } });
        if (!session) throw new BadRequestException('Abra la caja para registrar el egreso de esta compra');
        await tx.cashMovement.create({
          data: {
            tenantId: u.tenantId, sessionId: session.id, type: 'EXPENSE', category: 'PURCHASE', concept: `Compra a ${supplier.name}`,
            amount: purchase.total, method: dto.expense.method, responsibleName: u.name, purchaseId: purchase.id, createdById: u.sub,
          },
        });
      }
      for (const l of lines) {
        await tx.inventoryProduct.update({ where: { id: l.productId }, data: { stock: { increment: l.quantity }, cost: l.unitCost, supplierId: dto.supplierId, updatedById: u.sub } });
        await tx.inventoryMovement.create({
          data: { tenantId: u.tenantId, productId: l.productId, type: 'IN', quantity: l.quantity, reason: 'Compra', purchaseId: purchase.id, createdById: u.sub },
        });
      }
      return purchase;
    });
  }
}

@ApiTags('purchases')
@ApiBearerAuth()
@Controller('purchases')
export class PurchasesController {
  constructor(private svc: PurchasesService) {}
  @Perms('purchases:view') @Get() list(@CurrentUser() u: AuthUser) { return this.svc.list(u.tenantId); }
  @Perms('purchases:create') @Post() create(@CurrentUser() u: AuthUser, @Body() dto: PurchaseDto) { return this.svc.create(u, dto); }
}

@Module({ controllers: [PurchasesController], providers: [PurchasesService] })
export class PurchasesModule {}
