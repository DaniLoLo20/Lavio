import { BadRequestException, Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { diskStorage } from 'multer';
import { randomUUID } from 'crypto';
import { mkdirSync, promises as fsp } from 'fs';
import { join } from 'path';
import { AuthUser, CurrentUser, Perms } from '../../../common/guards';
import { OrdersService } from '../application/orders.service';
import { ArchiveDto, AssignDto, DeleteOrdersDto, EditVehicleDto, ChangeStatusDto, CreateOrderDto, ItemPriceDto, PaymentDto } from './dto';

const UPLOAD_DIR = () => process.env.UPLOAD_DIR || '/storage/uploads';
const EXT: Record<string, string> = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/heic': '.heic' };
const UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PHOTO_TYPES = ['FRONT', 'REAR', 'LEFT', 'RIGHT', 'EXTRA'];

@ApiTags('orders')
@ApiBearerAuth()
@Controller('orders')
export class OrdersController {
  constructor(private svc: OrdersService) {}

  @Perms('orders:create') @Post()
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateOrderDto) { return this.svc.create(u, dto); }

  @Perms('orders:edit') @Patch(':id/vehicle')
  vehicle(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: EditVehicleDto) { return this.svc.changeVehicle(u, id, dto); }

  @Perms('orders:delete') @Post('delete')
  removeMany(@CurrentUser() u: AuthUser, @Body() dto: DeleteOrdersDto) { return this.svc.remove(u, dto.ids.slice(0, 200)); }

  @Perms('orders:delete') @Delete(':id')
  removeOne(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.remove(u, [id]); }

  @Perms('orders:archive') @Post('archive')
  archive(@CurrentUser() u: AuthUser, @Body() dto: ArchiveDto) { return this.svc.archive(u, dto.ids.slice(0, 200), dto.archived); }

  @Perms('orders:view') @Get()
  list(@CurrentUser() u: AuthUser, @Query() q: any) { return this.svc.list(u, q); }

  @Perms('orders:view') @Get(':id')
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.get(u, id); }

  /** Admin y lavador (este ultimo solo de sus ordenes asignadas). El aviso no incluye precios. */
  @Perms('orders:notify') @Get(':id/notifications')
  notifications(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.notifications(u, id); }

  @Perms('orders:status') @Patch(':id/status')
  status(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ChangeStatusDto) {
    return this.svc.changeStatus(u, id, dto.status, dto.note, dto.at);
  }

  @Perms('orders:assign') @Patch(':id/assign')
  assign(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignDto) {
    return this.svc.assign(u, id, dto.assignedToId ?? null);
  }

  @Perms('orders:edit_price') @Patch(':id/items/:itemId/price')
  itemPrice(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('itemId', ParseUUIDPipe) itemId: string, @Body() dto: ItemPriceDto) {
    return this.svc.changeItemPrice(u, id, itemId, dto.unitPrice);
  }

  @Perms('orders:collect') @Post(':id/payments')
  pay(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PaymentDto) {
    return this.svc.addPayment(u, id, dto);
  }

  @Perms('orders:photos')
  @Post(':id/photos')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024 },
      fileFilter: (_req, file, cb) =>
        EXT[file.mimetype] ? cb(null, true) : cb(new BadRequestException('Solo imágenes JPG, PNG, WEBP o HEIC') as any, false),
      storage: diskStorage({
        destination: (req: any, _file, cb) => {
          const dir = join(UPLOAD_DIR(), req.user.tenantId);
          mkdirSync(dir, { recursive: true });
          cb(null, dir);
        },
        filename: (_req, file, cb) => cb(null, randomUUID() + EXT[file.mimetype]),
      }),
    }),
  )
  async photo(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('type') type: string,
    @Body('id') photoId?: string,
    @Body('takenAt') takenAt?: string,
  ) {
    const discard = () => (file ? fsp.unlink(file.path).catch(() => undefined) : undefined);
    if (!file) throw new BadRequestException('Archivo requerido');
    if (!PHOTO_TYPES.includes(type)) { await discard(); throw new BadRequestException('Tipo de foto inválido'); }
    if (photoId && !UUID4.test(photoId)) { await discard(); throw new BadRequestException('id de foto inválido'); }
    if (takenAt && isNaN(Date.parse(takenAt))) { await discard(); throw new BadRequestException('takenAt inválido'); }
    try {
      const { photo, duplicate } = await this.svc.addPhoto(u, id, type, `${u.tenantId}/${file.filename}`, { photoId, takenAt });
      if (duplicate) await discard(); // reintento de sincronización: no se guarda el archivo dos veces
      return photo;
    } catch (e) {
      await discard();
      throw e;
    }
  }
}
