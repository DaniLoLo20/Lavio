import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthUser } from '../../common/guards';
import { PrismaService } from '../../prisma/prisma.module';

const TTL_MS = 15_000;

/**
 * Ademas de verificar la firma, confirma (con cache de 15 s) que el usuario y la empresa siguen activos y carga el rol
 * y los PERMISOS vigentes. Asi, cuando el superadmin cambia los permisos de un rol o el rol de un usuario, el cambio
 * aplica en segundos sin que nadie tenga que volver a iniciar sesion. Desactivar a alguien o suspender una empresa
 * corta las sesiones igual de rapido.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private cache = new Map<string, { ok: boolean; role: string; perms: string[]; exp: number }>();

  constructor(private prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET!,
    });
  }

  async validate(p: AuthUser): Promise<AuthUser> {
    const k = `${p.sub}:${p.tenantId}:${p.impersonating ? 1 : 0}`;
    const hit = this.cache.get(k);
    if (hit && hit.exp > Date.now()) {
      if (!hit.ok) throw new UnauthorizedException();
      return { ...p, role: hit.role, perms: hit.perms };
    }
    const [user, tenant] = await Promise.all([
      this.prisma.user.findFirst({ where: { id: p.sub, isActive: true, deletedAt: null }, select: { role: { select: { name: true, permissions: true } } } }),
      this.prisma.tenant.findFirst({ where: { id: p.tenantId, isActive: true, deletedAt: null }, select: { id: true } }),
    ]);
    let ok = !!user && !!tenant;
    let role = user?.role.name ?? '';
    let perms = user?.role.permissions ?? [];
    if (ok && p.impersonating) {
      // Modo soporte: el usuario real es SUPERADMIN y actua con los permisos del Administrador
      ok = role === 'SUPERADMIN';
      if (ok) {
        const admin = await this.prisma.role.findUnique({ where: { name: 'ADMIN' }, select: { permissions: true } });
        role = 'ADMIN';
        perms = admin?.permissions ?? [];
      }
    }
    if (this.cache.size > 5000) this.cache.clear();
    this.cache.set(k, { ok, role, perms, exp: Date.now() + TTL_MS });
    if (!ok) throw new UnauthorizedException();
    return { ...p, role, perms };
  }
}