import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';

/** Nombre del rol (ADMIN, WASHER, SUPERADMIN o uno creado por el superadmin). */
export type RoleName = string;

export interface AuthUser {
  sub: string;
  tenantId: string;
  role: RoleName;
  name: string;
  /** true cuando un superadmin entra a una empresa en modo soporte */
  impersonating?: boolean;
  /** Permisos vigentes del rol (los pone JwtStrategy en cada peticion; no viajan en el token) */
  perms?: string[];
}

export const IS_PUBLIC = 'isPublic';
export const PERMS_KEY = 'perms';
export const Public = () => SetMetadata(IS_PUBLIC, true);
export const Roles = (...roles: RoleName[]) => SetMetadata('roles', roles);
/** Exige TODOS los permisos indicados. */
export const Perms = (...perms: string[]) => SetMetadata(PERMS_KEY, { all: perms });
/** Basta con UNO de los permisos indicados (p. ej. listar servicios para el POS). */
export const PermsAny = (...perms: string[]) => SetMetadata(PERMS_KEY, { any: perms });
export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user,
);

export const hasPerm = (u: AuthUser | undefined, p: string) => !!u?.perms?.includes(p);

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }
  canActivate(ctx: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    return isPublic ? true : super.canActivate(ctx);
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}
  canActivate(ctx: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<RoleName[]>('roles', [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!roles?.length) return true;
    const user = ctx.switchToHttp().getRequest().user as AuthUser | undefined;
    return !!user && roles.includes(user.role);
  }
}

/** Autoriza por permisos del rol (configurables por el superadmin). */
@Injectable()
export class PermsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}
  canActivate(ctx: ExecutionContext): boolean {
    const need = this.reflector.getAllAndOverride<{ all?: string[]; any?: string[] }>(PERMS_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!need) return true;
    const user = ctx.switchToHttp().getRequest().user as AuthUser | undefined;
    const have = new Set(user?.perms ?? []);
    if (need.all) return need.all.every((p) => have.has(p));
    if (need.any) return need.any.some((p) => have.has(p));
    return true;
  }
}
