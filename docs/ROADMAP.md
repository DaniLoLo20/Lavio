# Roadmaps

## Fase 1 (MVP, implementado)

- Auth JWT, roles Administrador y Lavador, multi-tenant por `tenant_id`.
- POS: orden con varios servicios, descuento, IVA, total, pago en efectivo, tarjeta o transferencia.
- Recepción: folio, código, QR, placa manual + OCR opcional, datos de cliente opcionales, fotos por tipo.
- Estados, tiempos y historial completo. Vista del lavador sin datos financieros.
- Consulta pública por QR o código, con avance, historial y fotos.
- Avisos por WhatsApp (wa.me) y correo (mailto) con mensaje precargado.
- Servicios, clientes, inventario, proveedores, compras con actualización de stock.
- Dashboard: hoy, semana (con crecimiento), mes, stock bajo, órdenes activas.
- Docker Compose, volúmenes persistentes, scripts BAT, modo claro/oscuro, PWA instalable.

## Fase 2 (producción y robustez)

1. Migraciones versionadas (`prisma migrate`) en lugar de `db push`; CI con build y pruebas.
2. Pruebas: unitarias del dominio (`order-rules`), e2e de la API con Postgres de prueba.
3. HTTPS con Caddy/Traefik en el compose, respaldos automáticos (pg_dump + volumen de fotos) y rotación.
4. Refresh tokens, revocación al desactivar usuario, cambio de contraseña, bloqueo por intentos.
5. Row Level Security en PostgreSQL como segunda barrera multi-tenant.
6. Descuento automático de inventario por servicio (receta: servicio → insumos).
7. Pagos parciales con corte de caja, cancelaciones y reembolsos.
8. Reportes exportables (CSV/PDF), ticket imprimible, filtros de dashboard por rango.
9. Fotos en almacenamiento S3-compatible (MinIO) con URLs firmadas y miniaturas.
10. Notificaciones web push (PWA) al cliente al cambiar de estado, sin costo de API.
11. Modo offline en el lavador (cola de cambios y fotos).

## Roadmap comercial SaaS

| Etapa | Objetivo | Acciones |
|---|---|---|
| 1. Piloto (mes 1-2) | Validar con 3-5 autolavados | Instalación asistida, planes gratuitos a cambio de retroalimentación, medir órdenes/día y tiempo de captura |
| 2. Lanzamiento (mes 3-4) | Primeros ingresos | Activar `register-tenant` con onboarding autoservicio, página comercial, demo pública, soporte por WhatsApp |
| 3. Planes (mes 4-6) | Monetizar | Básico (1 sucursal, 2 usuarios), Pro (varios usuarios, inventario, reportes), Multi-sucursal. Cobro mensual con Stripe o Mercado Pago, límites por plan en el backend |
| 4. Crecimiento (mes 6-12) | Escalar | Sucursales por tenant, marca blanca (logo, colores), dominio propio por cliente, programa de referidos, integración con facturación CFDI |
| 5. Plataforma (año 2) | Diferenciar | Membresías y lealtad de clientes, citas en línea, WhatsApp Business API opcional (de pago), API pública y marketplace de proveedores |

Métricas a vigilar: autolavados activos, órdenes por tenant por semana, retención a 90 días, MRR, costo de soporte por cliente.
