import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { PrismaService } from '../prisma/prisma.module';

/** Registra en audit_logs toda peticion mutante autenticada (sin cuerpo, para no guardar secretos). */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private prisma: PrismaService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest();
    if (req.method === 'GET' || req.method === 'OPTIONS') return next.handle();
    return next.handle().pipe(
      tap(() => {
        const user = req.user;
        if (!user?.tenantId) return;
        this.prisma.auditLog
          .create({
            data: {
              tenantId: user.tenantId,
              userId: user.sub,
              method: req.method,
              path: String(req.originalUrl).split('?')[0],
              statusCode: ctx.switchToHttp().getResponse().statusCode,
              ip: req.ip,
            },
          })
          .catch(() => undefined);
      }),
    );
  }
}
