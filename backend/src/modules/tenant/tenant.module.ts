import { BadRequestException, Body, Controller, Delete, Get, Injectable, Module, Patch, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Length, Matches, Max, Min, MinLength } from 'class-validator';
import { diskStorage } from 'multer';
import { randomUUID } from 'crypto';
import { mkdirSync, promises as fsp } from 'fs';
import { join } from 'path';
import { PrismaService } from '../../prisma/prisma.module';
import { AuthUser, CurrentUser, Perms, PermsAny, Roles } from '../../common/guards';

const UPLOAD_DIR = () => process.env.UPLOAD_DIR || '/storage/uploads';
// SVG no se admite: puede contener scripts y el logo se sirve como archivo publico
const LOGO_EXT: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };

class UpdateSettingsDto {
  @IsOptional() @IsString() @MinLength(2) name?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(100) taxRate?: number;
  @IsOptional() @IsString() @Length(3, 3) currency?: string;
  @IsOptional() @Matches(/^\d{1,4}$/, { message: 'countryCode: solo dígitos (ej. 52)' }) countryCode?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() taxId?: string;
}

const logoUrl = (p?: string | null) => (p ? `/api/uploads/${p}` : null);
const pick = (t: any) => ({
  id: t.id, name: t.name, slug: t.slug, taxRate: Number(t.taxRate), currency: t.currency, countryCode: t.countryCode,
  phone: t.phone, address: t.address, taxId: t.taxId, plan: t.plan, maxUsers: t.maxUsers, logoUrl: logoUrl(t.logoPath),
});

@Injectable()
export class TenantService {
  constructor(private prisma: PrismaService) {}

  async get(u: AuthUser) {
    const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: u.tenantId } });
    const users = await this.prisma.user.count({ where: { tenantId: u.tenantId, deletedAt: null } });
    return { ...pick(t), users };
  }

  async update(u: AuthUser, dto: UpdateSettingsDto) {
    const t = await this.prisma.tenant.update({ where: { id: u.tenantId }, data: { ...dto, currency: dto.currency?.toUpperCase() } });
    return pick(t);
  }

  /** Reemplaza el logo de la empresa y borra el anterior. */
  async setLogo(u: AuthUser, relativePath: string | null) {
    const before = await this.prisma.tenant.findUniqueOrThrow({ where: { id: u.tenantId }, select: { logoPath: true } });
    const t = await this.prisma.tenant.update({ where: { id: u.tenantId }, data: { logoPath: relativePath } });
    if (before.logoPath && before.logoPath !== relativePath) await fsp.unlink(join(UPLOAD_DIR(), before.logoPath)).catch(() => undefined);
    return pick(t);
  }
}

@ApiTags('tenant')
@ApiBearerAuth()
@Controller('tenant')
export class TenantController {
  constructor(private svc: TenantService) {}
  @Perms('settings:view') @Get('settings') get(@CurrentUser() u: AuthUser) { return this.svc.get(u); }
  @Perms('settings:edit') @Patch('settings') update(@CurrentUser() u: AuthUser, @Body() dto: UpdateSettingsDto) { return this.svc.update(u, dto); }

  @Perms('settings:edit')
  @Post('logo')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 2 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => (LOGO_EXT[file.mimetype] ? cb(null, true) : cb(new BadRequestException('El logo debe ser PNG, JPG o WEBP (máx. 2 MB)') as any, false)),
      storage: diskStorage({
        destination: (req: any, _file, cb) => {
          const dir = join(UPLOAD_DIR(), req.user.tenantId, 'brand');
          mkdirSync(dir, { recursive: true });
          cb(null, dir);
        },
        filename: (_req, file, cb) => cb(null, `logo-${randomUUID()}${LOGO_EXT[file.mimetype]}`),
      }),
    }),
  )
  async logo(@CurrentUser() u: AuthUser, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('Archivo requerido');
    try {
      return await this.svc.setLogo(u, `${u.tenantId}/brand/${file.filename}`);
    } catch (e) {
      await fsp.unlink(file.path).catch(() => undefined);
      throw e;
    }
  }

  @Perms('settings:edit') @Delete('logo') removeLogo(@CurrentUser() u: AuthUser) { return this.svc.setLogo(u, null); }
}

@Module({ controllers: [TenantController], providers: [TenantService] })
export class TenantModule {}
