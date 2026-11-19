# Lavio - Control inteligente para tu autolavado

<p align="center"><img src="frontend/public/brand/lavio-full.png" width="320" alt="Lavio"></p>

Lavio es una plataforma multiempresa (PWA) para autolavados. NestJS + Prisma + PostgreSQL en el backend, Next.js (App Router) + Tailwind + React Query en el frontend. Todo corre en Docker.

## Inicio rápido

Requisito único: Docker Desktop (Windows) o Docker Engine + Compose (Linux).

```
docker compose up -d --build     # o doble clic en start.bat (Windows) / ./start.sh (Linux, VPS)
docker compose down              # o stop.bat (conserva datos)
reset.bat                        # BORRA base de datos y fotos (pide confirmación)
```

| Servicio | URL |
|---|---|
| App (PWA) | http://localhost:3000 |
| API + Swagger | http://localhost:3001/api/docs |
| Consulta de cliente | http://localhost:3000/track |

Superadmin de plataforma (ve y administra todas las empresas): `superadmin@plataforma.local` / `Super123!` (cambie la contrasena en `.env`).
Usuarios demo (negocio `demo`): `admin@demo.com / Admin123!` y `lavador@demo.com / Lavador123!`.
Desde un celular en la misma red use `http://IP-DE-LA-PC:3000`.

> Red corporativa con proxy TLS: si el build falla con `self-signed certificate`, ejecute una vez
> `set NODE_TLS_REJECT_UNAUTHORIZED=0` antes de `docker compose up -d --build`. Esto desactiva la verificación TLS durante el build; úselo solo si confía en su red. Lo correcto es instalar el certificado de su proxy en la imagen.

## Persistencia (Docker volumes)

| Volumen | Contenido | Ruta en contenedor |
|---|---|---|
| `autolavado_pgdata` | Base de datos PostgreSQL | `/var/lib/postgresql/data` |
| `autolavado_uploads` | Fotografías | `/storage/uploads/<tenantId>/<uuid>.jpg` |

`down` y reinicios no los borran. Solo `docker compose down -v` o `reset.bat`.
Respaldo: `docker compose exec db pg_dump -U autolavado autolavado > backup.sql` y
`docker run --rm -v autolavado_uploads:/d -v %cd%:/b alpine tar czf /b/uploads.tgz -C /d .`

## Variables de entorno (`.env`)

Ver `.env.example`. Cambie `POSTGRES_PASSWORD` y `JWT_SECRET` antes de producción y ponga `SEED_DEMO=false`.

## Estructura

```
backend/
  prisma/schema.prisma, seed.js
  src/
    common/            guards JWT + roles, auditoría
    prisma/
    modules/
      auth/ users/ clients/ services/ inventory/ purchases/ dashboard/ public/
      orders/
        domain/          reglas puras (estados, totales, códigos) + puerto del repositorio
        application/     casos de uso (OrdersService)
        infrastructure/  PrismaOrderRepository
        presentation/    controller + DTOs
frontend/
  src/app/
    login, track/[code]            (públicas)
    (app)/ dashboard, pos, orders, orders/[id], washer, services, clients, inventory, purchases, users
  src/components/ui.tsx            componentes estilo shadcn
  src/lib/                         api, auth, utils
  public/                          manifest, service worker, íconos
docker-compose.yml  .env.example  start.bat  stop.bat  reset.bat  start.sh  stop.sh  reset.sh
```

## Endpoints (prefijo `/api`, Bearer JWT salvo los públicos)

| Método | Ruta | Rol |
|---|---|---|
| POST | `/auth/login` | público |
| POST | `/auth/register-tenant` | público, solo si `ALLOW_TENANT_REGISTRATION=true` |
| GET | `/auth/me` | autenticado |
| GET | `/public/track/:code` | público (sin datos de cliente ni montos) |
| GET/POST/PATCH/DELETE | `/users`, `/users/washers` | ADMIN |
| GET/POST/PATCH/DELETE | `/clients` | ADMIN |
| GET/POST/PATCH/DELETE | `/services` | ADMIN |
| POST | `/orders` | ADMIN |
| GET | `/orders`, `/orders/:id` | ADMIN (todo) / WASHER (solo asignadas, sin montos) |
| PATCH | `/orders/:id/status` | ADMIN / WASHER (no puede `ENTREGADO`) |
| PATCH | `/orders/:id/assign` | ADMIN |
| POST | `/orders/:id/photos` (multipart `file`, `type`) | ADMIN / WASHER asignado |
| POST | `/orders/:id/payments` | ADMIN |
| GET | `/orders/:id/notifications` (enlaces wa.me y mailto) | ADMIN |
| GET/POST/PATCH/DELETE | `/inventory/products` | ADMIN |
| GET/POST | `/inventory/movements`, `/inventory/suppliers` | ADMIN |
| GET/POST | `/purchases` | ADMIN |
| GET | `/dashboard/summary` | ADMIN |

## Seguridad y multi-tenant

- `tenant_id` en todas las tablas de negocio; cada consulta del backend filtra por el `tenantId` del JWT.
- Contraseñas con bcrypt, JWT de 12 h, rate limit global (300/min), 10/min en login y 30/min en consulta pública.
- Código de consulta de 6 caracteres sin ambigüedades (31^6 ≈ 887 millones) y placa enmascarada en la vista pública.
- Fotos: solo JPG/PNG/WEBP/HEIC, máx. 10 MB, nombre UUID. Las URLs son públicas pero no adivinables.
- `audit_logs` registra toda petición mutante (usuario, método, ruta, IP, estado).

## Decisiones y límites conocidos

- El esquema se aplica con `prisma db push` al arrancar. Para producción con datos reales cambie a `prisma migrate` (ver Roadmap Fase 2).
- Patrón Repository completo (puerto + implementación) en `orders`, el módulo con más reglas. Los demás módulos usan Prisma directamente en un servicio delgado; se extraen a repositorios cuando crezcan sus reglas.
- OCR de placas con Tesseract.js en el navegador; descarga datos de idioma la primera vez (requiere internet). Siempre se puede capturar a mano.
- El JWT no se revoca antes de vencer: desactivar un usuario surte efecto en el siguiente login.
- Zona horaria de los reportes: la del servidor (`TZ`, por defecto America/Mexico_City).
- HTTPS: la cámara y la instalación PWA en celulares exigen HTTPS fuera de `localhost`. En VPS ponga Caddy o Traefik delante del puerto 3000 (ver Roadmap).

Más detalle en `docs/ARCHITECTURE.md` y `docs/ROADMAP.md`.

## Funciona sin internet (offline-first)

Todo lo que el personal hace en piso funciona sin conexión y se sincroniza solo al volver la red.

| Se puede hacer sin conexión | Cómo se guarda |
|---|---|
| Crear órdenes (POS completo) | IndexedDB (Dexie) + cola de sincronización |
| Cambiar estatus (incluye hora de inicio/fin y tiempo total) | Cola de sincronización |
| Tomar fotografías | La imagen comprimida queda en IndexedDB hasta subirse |
| Abrir pantallas, órdenes, servicios, catálogo | Service worker (app) + React Query Persist (datos) |

Requiere conexión: cobrar después, asignar lavador, avisos por WhatsApp/correo, reportes, y administrar usuarios/inventario/compras.

**Cómo evita duplicados.** El dispositivo genera el `id` (UUID) y el código de la orden y el `id` de cada foto. El backend los usa como clave de idempotencia: reenviar la misma orden o foto devuelve la ya creada (aunque la respuesta se haya perdido). Un `id` de otra empresa responde 409.

**Conflictos.** Cada acción lleva la hora real en que ocurrió (corregida con la hora del servidor). Si el servidor ya tiene un cambio de estatus más reciente, el cambio viejo se rechaza con 409 `STALE`: prevalece el más reciente, queda en el panel de sincronización como *Conflicto* y no se pierde ni se pisa nada. Un reintento del mismo estatus es exitoso (idempotente). Relojes con fecha futura o de hace más de 30 días se acotan.

**Panel de sincronización.** El icono de nube (arriba) muestra pendientes, rechazados y conflictos; permite sincronizar ahora, reintentar o descartar.

**Notas y límites**
- Los datos locales se guardan por usuario: si alguien cierra sesión con cambios pendientes, siguen en el dispositivo y se envían cuando ese usuario vuelve a entrar. La caché de datos sí se borra al cambiar de usuario o empresa.
- Si el token vence mientras no hay red (12 h), la app sigue funcionando; al reconectar pide iniciar sesión y entonces sincroniza.
- La sincronización ocurre con la app abierta (o al abrirla). Background Sync del navegador solo despierta a la app si hay una ventana abierta.
- Fuera de `localhost`, el service worker y la instalación de la PWA exigen HTTPS.
- El servidor recalcula precios, IVA y folio al sincronizar; el total mostrado sin conexión es una estimación. El folio (`AL-000123`) se asigna al sincronizar; el código y el QR del cliente ya son válidos desde el principio.
- La primera vez hay que abrir la app con conexión para que se guarde para uso sin internet.
## Caja y Finanzas

**Caja** (`/cash`, solo administrador). Una sola caja abierta por empresa (lo garantiza la base de datos).
- *Apertura:* usuario, fecha, hora y monto inicial.
- *Ingresos* manuales (venta de servicios, venta de productos, ingreso extraordinario, ajuste) y *egresos* (compras, papelería, gastos operativos, nómina, mantenimiento, otros) con concepto, categoría, monto, método, responsable y **evidencia fotográfica opcional**. Los comprobantes son privados: solo se entregan con sesión y de la propia empresa.
- Los **cobros de órdenes** no se capturan dos veces: el corte los toma de los pagos registrados desde la apertura.
- *Corte:* caja inicial, total ingresos, total egresos, **caja esperada**, caja real, diferencia. La caja esperada solo cuenta **efectivo**; tarjeta y transferencia se muestran aparte. Al cerrar se guarda una foto fija de las cifras; si después se sincronizan cobros de ese turno (órdenes capturadas sin conexión) se avisa en el reporte. Se puede imprimir y descargar en CSV.
- **Vender desde la caja:** con la caja abierta, la pestaña *Nueva venta* es el mismo punto de venta de *Nueva orden* (con Modo Voz y sin conexión), pero cada venta se cobra al momento y las cifras se actualizan al instante. *Nueva orden* sigue existiendo y permite *Cobrar después*; ambas se suman a la misma caja.
- **Por cobrar:** lista de órdenes con saldo (de cualquier fecha) para cobrarlas desde la caja, completas o con abonos parciales; no se puede cobrar más que el saldo. Lo cobrado cae en la caja abierta.
- Las ventas capturadas sin conexión se avisan como "sin sincronizar" y se suman a la caja al sincronizar.
- Una compra registrada en Compras puede generar su egreso en caja (casilla "Registrar también como egreso de caja").

**Finanzas** (`/finance`): utilidad del día, semanal y mensual (ingresos = cobros de órdenes + ingresos de caja; egresos = egresos de caja), flujo de efectivo diario y acumulado, top gastos por categoría, mayores egresos, ingresos por método y por fuente. Reportes CSV: cortes y movimientos.

Límite: la caja necesita conexión (no forma parte de la cola offline); los cobros de órdenes hechos sin conexión sí se suman al sincronizar.

## Modo Voz

Botón flotante **Activar Modo Voz** (en el POS y, para el administrador, en las demás pantallas). Captura guiada: placa, nombre, teléfono, observaciones y servicio. Cada respuesta llena el formulario del POS; al final hay un **resumen editable** (con micrófono por campo para corregir) antes de guardar. Comandos de voz: *repetir, atrás, saltar, cancelar*.

- Usa la **Web Speech API del navegador** (reconocimiento y síntesis). No hay IA, LLM ni servicios propios o de terceros en el código: la interpretación (placas deletreadas, números en palabras, nombres, servicios con cantidad) son reglas y diccionarios en `frontend/src/lib/voice/parsers.ts`.
- Al guardar usa la misma cola **offline-first** que el POS: sin conexión la orden queda en el dispositivo y se sincroniza sola.
- Importante: en Chrome el reconocimiento suele procesarse en los servidores de Google, así que sin internet puede no funcionar salvo que el navegador tenga el idioma instalado (se usa en el dispositivo si está disponible). En ese caso el flujo avisa y se captura escribiendo. En navegadores sin soporte (p. ej. Firefox) el Modo Voz funciona igual, solo escribiendo.
- Marca, modelo y color no se piden por voz (no estaban en el guion) pero el resumen los exige antes de guardar; se pueden dictar o escribir ahí.
## Ticket al cliente, aviso del lavador y logo del negocio

- **Ticket con precios:** al crear una orden (POS o Caja) el comprobante muestra un **ticket de servicio** (servicios con precio, subtotal, descuento, IVA, total, pago o saldo, código y QR de consulta). Se envía por **WhatsApp** (enlace `wa.me` con el ticket precargado; sin APIs de pago, el empleado solo confirma), por **correo** o se **imprime** (formato 80 mm). Si el cliente no dio teléfono se puede escribir uno o elegir contacto en WhatsApp. También está en el detalle de cada orden (solo administrador). Sin conexión el ticket sale con precios estimados y se genera igual.
- **El lavador también avisa al cliente:** en sus órdenes asignadas tiene *Avisar al cliente* (WhatsApp/correo con el mensaje de "listo para entrega", sin precios), también desde su lista cuando la orden está en Secado o Finalizado. No puede avisar en órdenes que no le tocan. No ve precios ni el ticket.
- **Imagen del negocio (multiempresa):** cada empresa sube su logo en *Configuración > Imagen de tu negocio* (PNG/JPG/WEBP, se ajusta a 512 px). Se usa en el menú, el ticket y la consulta pública del cliente. Mientras no suba una se usa la marca Lavio. El logo se sirve como archivo público (no pongas ahí nada sensible).

## Modo Voz (v2)

- **Una sola pregunta para vehículo:** "Dime la marca, el modelo y el color". Se separan solos con el catálogo, alias (VW, chevy) y números en palabras ("Mazda tres"). Si falta algo, pregunta solo lo que falta. Se puede corregir escribiendo o con el micrófono de cada campo.
- **Resumen leído y guardado por voz:** al final se lee el resumen y se puede decir *guardar*, *corregir*, *cancelar* o *repetir*. Con datos faltantes no guarda y lo dice.
- **Configuración:** engranaje dentro del Modo Voz o *Configuración > Modo Voz*: tiempo entre preguntas (0 = manual), pausa antes de escuchar, tiempo máximo de escucha, velocidad e idioma de la voz, leer preguntas/resumen, guardar con la voz, escucha automática. Se guarda en cada dispositivo.
- **Botón flotante arrastrable:** se mueve a cualquier parte con el dedo o el ratón, recuerda su lugar y se puede restablecer.
## Roles, permisos y menú

- **Roles y permisos** (solo superadmin, menú *Configuración > Roles y permisos*, ruta `/platform/roles`): crea, duplica, edita y elimina roles. Cada rol es un conjunto de permisos `recurso:acción` (ver, crear, editar, eliminar, exportar y acciones propias como cobrar, entregar, ajustar stock). Los roles son globales de la plataforma; el administrador de cada empresa solo los asigna a sus usuarios (`Usuarios`), y no puede dar permisos que él no tenga.
- `ADMIN` siempre tiene todos los permisos y no se edita. `WASHER` (Lavador) es editable. Un rol con usuarios activos no se puede eliminar.
- Los permisos se leen en cada petición (caché de ~15 s), así que un cambio de rol se aplica sin volver a iniciar sesión. El backend los exige en cada endpoint; el frontend además oculta menús y botones.
- **Menú por módulos** desplegables: Operación, Caja y finanzas, Catálogo, Inventario, Administración. Recuerda qué módulos dejaste abiertos. En celular: barra inferior con accesos rápidos y hoja *Menú*.
- **Inventario** se divide en *Productos* (`/inventory/products`: búsqueda, filtros por categoría/proveedor/existencia, orden, alta, edición, baja, ajuste de stock, exportar) y *Movimientos* (`/inventory/movements`: filtros por tipo/producto/fechas y registro).
## Linux / VPS

`chmod +x *.sh` una vez y luego `./start.sh` (crea `.env` con secretos aleatorios la primera vez e imprime la clave del superadmin), `./stop.sh` y `./reset.sh` (borra datos; pide escribir BORRAR). Requiere Docker con el plugin `docker compose`. Para PWA, camara y Modo Voz en un VPS se necesita HTTPS: ponga un proxy inverso (Caddy/Nginx) hacia el puerto 3000. Los `.sh` se guardan con saltos de linea LF (`.gitattributes`).

## Autocompletar clientes

En Nueva orden/Caja, al escribir nombre o teléfono se sugieren clientes existentes; al escribir una placa conocida se rellenan vehículo y cliente. El Modo Voz reconoce por placa, nombre exacto o teléfono, avisa «Cliente registrado» y omite las preguntas que ya conoce. Al elegir un cliente la orden se liga a él (`client.id`); sin elegirlo, el backend ya evitaba duplicados por teléfono. El índice (`GET /clients/lookup`, hasta 2000 clientes) se guarda en caché y funciona sin conexión.
