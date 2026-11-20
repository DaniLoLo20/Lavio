/* Seed idempotente: roles siempre; negocio demo solo si SEED_DEMO != false */
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  // Solo existen RECIBIDO y FINALIZADO: se migran los estatus antiguos (idempotente)
  await prisma.washOrder.updateMany({ where: { status: { in: ['EN_ESPERA', 'EN_PROCESO', 'SECADO'] } }, data: { status: 'RECIBIDO' } });
  await prisma.washOrder.updateMany({ where: { status: 'ENTREGADO' }, data: { status: 'FINALIZADO' } });
  const admin = await prisma.role.upsert({
    where: { name: 'ADMIN' },
    update: {},
    create: { name: 'ADMIN', description: 'Administrador' },
  });
  const superRole = await prisma.role.upsert({
    where: { name: 'SUPERADMIN' },
    update: {},
    create: { name: 'SUPERADMIN', description: 'Superadministrador de plataforma' },
  });
  const washer = await prisma.role.upsert({
    where: { name: 'WASHER' },
    update: {},
    create: { name: 'WASHER', description: 'Lavador' },
  });

  // Empresa interna de plataforma + superadmin (solo si se definen las variables; nunca pisa una contrasena existente)
  if (process.env.SUPERADMIN_EMAIL && process.env.SUPERADMIN_PASSWORD) {
    const platform = await prisma.tenant.upsert({
      where: { slug: 'platform' },
      update: {},
      create: { name: 'Plataforma', slug: 'platform', plan: 'internal', maxUsers: 5 },
    });
    const email = process.env.SUPERADMIN_EMAIL.toLowerCase();
    const exists = await prisma.user.findFirst({ where: { tenantId: platform.id, email } });
    if (!exists) {
      await prisma.user.create({
        data: { tenantId: platform.id, roleId: superRole.id, email, fullName: 'Superadministrador', passwordHash: await bcrypt.hash(process.env.SUPERADMIN_PASSWORD, 10) },
      });
      console.log('Superadmin creado:', email);
    }
  }

  // Catalogo de vehiculos (idempotente)
  const catalog = require('./vehicle-catalog');
  await prisma.vehicleBrand.createMany({ data: Object.keys(catalog).map((name) => ({ name })), skipDuplicates: true });
  const brands = await prisma.vehicleBrand.findMany();
  await prisma.vehicleModel.createMany({
    data: brands.flatMap((b) => (catalog[b.name] || []).map((name) => ({ brandId: b.id, name }))),
    skipDuplicates: true,
  });

  if (process.env.SEED_DEMO === 'false') return;
  if (await prisma.tenant.findUnique({ where: { slug: 'demo' } })) return;

  const tenant = await prisma.tenant.create({ data: { name: 'Autolavado Demo', slug: 'demo' } });
  const adminPw = await bcrypt.hash(process.env.SEED_ADMIN_PASSWORD || 'Admin123!', 10);
  const washerPw = await bcrypt.hash(process.env.SEED_WASHER_PASSWORD || 'Lavador123!', 10);

  await prisma.user.createMany({
    data: [
      { tenantId: tenant.id, roleId: admin.id, email: 'admin@demo.com', passwordHash: adminPw, fullName: 'Administrador Demo' },
      { tenantId: tenant.id, roleId: washer.id, email: 'lavador@demo.com', passwordHash: washerPw, fullName: 'Lavador Demo' },
    ],
  });

  await prisma.service.createMany({
    data: [
      ['Lavado Básico', 'Exterior y enjuague', 120],
      ['Lavado Premium', 'Exterior, interior y llantas', 220],
      ['Aspirado', 'Aspirado completo interior', 60],
      ['Encerado', 'Cera protectora', 150],
      ['Pulido', 'Pulido de pintura', 450],
      ['Sanitización', 'Sanitización interior', 100],
    ].map(([name, description, price]) => ({ tenantId: tenant.id, name, description, price })),
  });

  await prisma.inventoryProduct.createMany({
    data: [
      ['SH-001', 'Shampoo automotriz', 'Shampoo', 20, 5, 85],
      ['CE-001', 'Cera líquida', 'Cera', 10, 3, 140],
      ['AR-001', 'Aromatizante', 'Aromatizante', 30, 10, 25],
      ['DE-001', 'Desengrasante', 'Desengrasante', 8, 3, 95],
      ['MI-001', 'Microfibra', 'Microfibras', 40, 15, 18],
    ].map(([sku, name, category, stock, minStock, cost]) => ({ tenantId: tenant.id, sku, name, category, stock, minStock, cost })),
  });

  console.log('Seed demo creado: admin@demo.com / lavador@demo.com');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
