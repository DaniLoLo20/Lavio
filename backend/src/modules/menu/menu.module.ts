import { BadRequestException, Body, Controller, Delete, Get, Injectable, Module, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsArray } from 'class-validator';
import { PrismaService } from '../../prisma/prisma.module';
import { Roles } from '../../common/guards';

const KEY = 'menu_layout';
const HREF = /^\/[a-z0-9/-]{1,60}$/;
const GROUP_KEY = /^[a-z0-9_-]{1,30}$/;

type Entry = { type: 'item'; href: string } | { type: 'group'; key: string; label?: string; items: string[] };

class LayoutDto {
  @IsArray() layout: unknown[];
}

/** Valida y limpia el orden del menú. Solo guarda claves y rutas; los permisos siguen decidiendo qué ve cada quien. */
function sanitize(raw: unknown[]): Entry[] {
  if (raw.length > 40) throw new BadRequestException('Demasiadas entradas en el menú');
  const seen = new Set<string>();
  const groups = new Set<string>();
  const out: Entry[] = [];
  for (const e of raw as any[]) {
    if (e?.type === 'item' && typeof e.href === 'string' && HREF.test(e.href)) {
      if (seen.has(e.href)) continue;
      seen.add(e.href);
      out.push({ type: 'item', href: e.href });
    } else if (e?.type === 'group' && typeof e.key === 'string' && GROUP_KEY.test(e.key) && Array.isArray(e.items)) {
      if (groups.has(e.key)) continue;
      groups.add(e.key);
      const items = (e.items as unknown[]).filter((h): h is string => typeof h === 'string' && HREF.test(h) && !seen.has(h)).slice(0, 30);
      items.forEach((h) => seen.add(h));
      const label = typeof e.label === 'string' ? e.label.trim().slice(0, 40) : '';
      out.push({ type: 'group', key: e.key, ...(label ? { label } : {}), items });
    } else {
      throw new BadRequestException('Entrada de menú inválida');
    }
  }
  return out;
}

@Injectable()
export class MenuService {
  constructor(private prisma: PrismaService) {}
  async get() {
    const s = await this.prisma.platformSetting.findUnique({ where: { key: KEY } });
    return { layout: (s?.value as Entry[] | undefined) ?? null, updatedAt: s?.updatedAt ?? null };
  }
  async save(layout: unknown[]) {
    const value = sanitize(layout) as any;
    await this.prisma.platformSetting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
    return this.get();
  }
  async reset() {
    await this.prisma.platformSetting.deleteMany({ where: { key: KEY } });
    return this.get();
  }
}

@ApiTags('menu')
@ApiBearerAuth()
@Controller()
export class MenuController {
  constructor(private svc: MenuService) {}
  /** Cualquier usuario con sesión: se usa para dibujar su menú. */
  @Get('menu/layout') layout() { return this.svc.get(); }
  @Roles('SUPERADMIN') @Put('platform/menu') save(@Body() dto: LayoutDto) { return this.svc.save(dto.layout); }
  @Roles('SUPERADMIN') @Delete('platform/menu') reset() { return this.svc.reset(); }
}

@Module({ controllers: [MenuController], providers: [MenuService] })
export class MenuModule {}
