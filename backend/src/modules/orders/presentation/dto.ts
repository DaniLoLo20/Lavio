import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsDateString, IsEmail, IsEnum, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { ContactPreference, PaymentMethod } from '@prisma/client';

export class VehicleDto {
  @IsString() @MinLength(3) @MaxLength(12) plate: string;
  @IsString() @MinLength(1) brand: string;
  @IsString() @MinLength(1) model: string;
  @IsString() @MinLength(1) color: string;
}

export class ClientInputDto {
  /** Cliente ya existente elegido con el autocompletado: evita crear uno nuevo. */
  @IsOptional() @IsUUID() id?: string;
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsEnum(ContactPreference) contactPreference?: ContactPreference;
}

export class ItemDto {
  @IsUUID() serviceId: string;
  @IsInt() @Min(1) @Max(99) quantity: number;
}

export class PaymentDto {
  @IsEnum(PaymentMethod) method: PaymentMethod;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) amount?: number;
  @IsOptional() @IsString() reference?: string;
}

export class CreateOrderDto {
  /** UUID v4 generado por el cliente: clave de idempotencia para sincronizacion offline. */
  @IsOptional() @IsUUID('4') id?: string;
  @IsOptional() @Matches(/^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{6}$/, { message: 'code inválido' }) code?: string;
  /** Momento real de captura (ISO); se acota a los ultimos 30 dias y nunca al futuro. */
  @IsOptional() @IsDateString() createdAt?: string;
  @ValidateNested() @Type(() => VehicleDto) vehicle: VehicleDto;
  @IsOptional() @ValidateNested() @Type(() => ClientInputDto) client?: ClientInputDto;
  @IsOptional() @IsString() notes?: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => ItemDto) items: ItemDto[];
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) discount?: number;
  @IsOptional() @IsUUID() assignedToId?: string;
  @IsOptional() @ValidateNested() @Type(() => PaymentDto) payment?: PaymentDto;
}

export class ChangeStatusDto {
  @IsEnum(['RECIBIDO', 'EN_ESPERA', 'EN_PROCESO', 'SECADO', 'FINALIZADO', 'ENTREGADO']) status: any;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
  /** Momento real del cambio (ISO), para resolver conflictos por marca de tiempo. */
  @IsOptional() @IsDateString() at?: string;
}

export class AssignDto {
  @IsOptional() @IsUUID() assignedToId?: string | null;
}
