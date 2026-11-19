# Arquitectura

## Vista general

```
Navegador / PWA ──► frontend (Next.js :3000) ──/api/*──► backend (NestJS :3001) ──► PostgreSQL
                                                              │
                                                              └──► volumen /storage/uploads
```

El navegador solo habla con el origen del frontend. Next.js reenvía `/api/*` (incluidas las fotos en `/api/uploads/*`) al backend por la red interna de Docker. Así no hay CORS ni IPs fijas, y funciona igual desde un celular, una tablet o un VPS.

## Capas (módulo `orders`)

| Capa | Contenido | Depende de |
|---|---|---|
| domain | `order-rules.ts` (transiciones, tiempos, totales, folio, código), `WashOrderRepository` (puerto) | nada |
| application | `OrdersService` (casos de uso, permisos por rol, vista del lavador) | domain |
| infrastructure | `PrismaOrderRepository` (transacciones, folio por contador atómico) | domain, Prisma |
| presentation | `OrdersController`, DTOs, carga de fotos | application |

La inyección enlaza `WashOrderRepository` con `PrismaOrderRepository` en `OrdersModule`, por lo que la lógica se prueba sin base de datos.

## Reglas de negocio clave

- Folio `AL-000001`: contador `tenants.order_seq` incrementado dentro de la transacción de creación (sin duplicados bajo concurrencia).
- Código: 6 caracteres de un alfabeto sin 0/O/1/I/L, único global (lo usa la consulta pública).
- Totales: `total = (subtotal − descuento) + IVA`. El descuento se limita al subtotal. El precio y nombre del servicio se copian a `wash_order_items` (cambiar precios no altera órdenes pasadas).
- Estados: `RECIBIDO → EN_ESPERA/EN_PROCESO → SECADO → FINALIZADO → ENTREGADO` con retrocesos permitidos solo EN_PROCESO↔EN_ESPERA y SECADO→EN_PROCESO. El cambio usa `updateMany` condicionado al estado anterior para evitar carreras. Cada cambio escribe `wash_order_status_history`.
- Tiempos: `started_at` al primer EN_PROCESO, `finished_at` y `total_seconds` en FINALIZADO, `delivered_at` en ENTREGADO.
- Lavador: ve solo órdenes asignadas, sin montos ni datos de contacto, y no puede marcar ENTREGADO.
- Compras: transacción única que crea la compra, suma existencias, actualiza costo y registra movimientos IN.

## Modelo de datos

Tablas: `tenants, roles, users, clients, vehicles, services, wash_orders, wash_order_items, wash_order_status_history, wash_order_photos, payments, suppliers, inventory_products, inventory_movements, purchases, purchase_items, audit_logs`.

- Todas con `tenant_id` (FK a `tenants`) salvo `roles` (catálogo global).
- `created_at/updated_at` y soft delete (`deleted_at`) en entidades editables; `created_by/updated_by` como auditoría ligera. Historial, items y movimientos son de solo inserción.
- Índices: `(tenant_id, status)`, `(tenant_id, received_at)`, `(tenant_id, assigned_to_id, status)`, `(tenant_id, plate)`, `(tenant_id, phone)`, únicos `(tenant_id, folio)`, `(tenant_id, email)`, `(tenant_id, sku)` y `code`.
- Multi-tenant por columna (base compartida). Ruta de endurecimiento: Row Level Security de PostgreSQL (Fase 2).

## Docker

- `backend`: build multi-etapa; al arrancar ejecuta `prisma db push`, seed idempotente y el servidor. Corre como usuario `node`.
- `frontend`: Next `output: standalone`, imagen final mínima.
- `db`: PostgreSQL 16 con healthcheck; el backend espera a `service_healthy`.
- Volúmenes con nombre: `autolavado_pgdata`, `autolavado_uploads`.

## PWA

`manifest.webmanifest`, íconos 192/512, service worker que habilita instalación y página offline. Las llamadas `/api` nunca se cachean. La captura de fotos usa `<input capture="environment">` y se comprime a ~1600 px antes de subir.

## Despliegue en VPS Linux

1. Instalar Docker, clonar el proyecto, copiar `.env.example` a `.env` con secretos reales y `SEED_DEMO=false`.
2. Poner un proxy HTTPS (Caddy: `tuDominio.com { reverse_proxy frontend:3000 }`) y no publicar los puertos 3000/3001 al exterior.
3. `docker compose up -d --build`. Respaldos con `pg_dump` y copia del volumen de fotos.
