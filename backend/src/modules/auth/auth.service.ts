import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.module';
import { AuthUser } from '../../common/guards';
import { LoginDto, RegisterTenantDto } from './dto';

// Hash fijo para igualar el tiempo de respuesta cuando el correo no existe
const DUMMY_HASH = bcrypt.hashSync('dummy-password', 10);

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService, private jwt: JwtService) {}

  private profile(user: { id: string; fullName: string; email: string }, role: { name: string; label: string | null; permissions: string[] }, t: any, support = false) {
    return {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      role: role.name,
      roleLabel: role.label ?? role.name,
      permissions: role.permissions,
      support,
      tenant: {
        id: t.id, name: t.name, slug: t.slug, taxRate: Number(t.taxRate), currency: t.currency,
        phone: t.phone, address: t.address, taxId: t.taxId, plan: t.plan, countryCode: t.countryCode,
        logoUrl: t.logoPath ? `/api/uploads/${t.logoPath}` : null,
      },
    };
  }

  /**
   * Si el mismo correo+contrasena existe en varias empresas devuelve la lista para que el usuario elija
   * (y reenvie con tenantSlug). Con una sola coincidencia inicia sesion.
   */
  async login(dto: LoginDto) {
    const candidates = await this.prisma.user.findMany({
      where: {
        email: dto.email.toLowerCase().trim(),
        deletedAt: null,
        isActive: true,
        tenant: { isActive: true, deletedAt: null, ...(dto.tenantSlug ? { slug: dto.tenantSlug } : {}) },
      },
      include: { role: true, tenant: true },
    });
    if (!candidates.length) await bcrypt.compare(dto.password, DUMMY_HASH);
    const matches: typeof candidates = [];
    for (const u of candidates) if (await bcrypt.compare(dto.password, u.passwordHash)) matches.push(u);
    if (!matches.length) throw new UnauthorizedException('Credenciales inválidas');

    if (matches.length > 1) {
      return { needTenant: true as const, companies: matches.map((m) => ({ slug: m.tenant.slug, name: m.tenant.name })) };
    }
    const user = matches[0];
    const payload: AuthUser = { sub: user.id, tenantId: user.tenantId, role: user.role.name as AuthUser['role'], name: user.fullName };
    return { accessToken: await this.jwt.signAsync(payload), user: this.profile(user, user.role, user.tenant) };
  }

  async me(auth: AuthUser) {
    const [user, tenant] = await Promise.all([
      this.prisma.user.findFirst({ where: { id: auth.sub, deletedAt: null, isActive: true }, include: { role: true } }),
      this.prisma.tenant.findFirst({ where: { id: auth.tenantId, deletedAt: null, isActive: true } }),
    ]);
    if (!user || !tenant) throw new UnauthorizedException();
    const role = auth.impersonating ? await this.prisma.role.findUniqueOrThrow({ where: { name: 'ADMIN' } }) : user.role;
    return this.profile(user, role, tenant, !!auth.impersonating);
  }

  /** Superadmin entra a una empresa como ADMIN (token de 2 h, marcado como soporte y auditado en esa empresa). */
  async impersonate(auth: AuthUser, tenantId: string) {
    const tenant = await this.prisma.tenant.findFirst({ where: { id: tenantId, isActive: true, deletedAt: null, slug: { not: 'platform' } } });
    if (!tenant) throw new NotFoundException('Empresa no encontrada o suspendida');
    const user = await this.prisma.user.findFirstOrThrow({ where: { id: auth.sub } });
    const adminRole = await this.prisma.role.findUniqueOrThrow({ where: { name: 'ADMIN' } });
    const payload: AuthUser = { sub: auth.sub, tenantId, role: 'ADMIN', name: `Soporte (${user.fullName})`, impersonating: true };
    await this.prisma.auditLog.create({
      data: { tenantId, userId: auth.sub, method: 'SUPPORT', path: '/auth/impersonate', statusCode: 200 },
    });
    return { accessToken: await this.jwt.signAsync(payload, { expiresIn: '2h' }), user: this.profile(user, adminRole, tenant, true) };
  }

  async registerTenant(dto: RegisterTenantDto) {
    if (process.env.ALLOW_TENANT_REGISTRATION !== 'true') {
      throw new ForbiddenException('El registro de negocios está deshabilitado');
    }
    if (dto.slug === 'platform' || (await this.prisma.tenant.findUnique({ where: { slug: dto.slug } }))) {
      throw new ConflictException('El identificador del negocio ya existe');
    }
    const role = await this.prisma.role.findUniqueOrThrow({ where: { name: 'ADMIN' } });
    await this.prisma.tenant.create({
      data: {
        name: dto.tenantName,
        slug: dto.slug,
        users: {
          create: {
            roleId: role.id,
            email: dto.email.toLowerCase().trim(),
            fullName: dto.fullName,
            passwordHash: await bcrypt.hash(dto.password, 10),
          },
        },
      },
    });
    return this.login({ email: dto.email, password: dto.password, tenantSlug: dto.slug });
  }
}
