import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding Zentary database...');

  const hashedPassword = await bcrypt.hash('zentary123', 10);

  // Property
  const property = await prisma.property.create({
    data: {
      unitNumber: 'Apt 502',
      block: 'Torre B',
    },
  });

  // User Resident
  const resident = await prisma.user.upsert({
    where: { email: 'residente@zentary.com' },
    update: {},
    create: {
      email: 'residente@zentary.com',
      password: hashedPassword,
      fullName: 'María Camila Rodríguez',
      phone: '+503 7000-0000',
      role: 'RESIDENT',
      propertyId: property.id,
      avatarUrl: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150',
    },
  });

  console.log(`Created Resident User: ${resident.email}`);

  // Initial PQRS
  await prisma.pqrs.create({
    data: {
      residentId: resident.id,
      category: 'PETICION',
      subject: 'Solicitud de control de acceso adicional',
      description: 'Deseo solicitar un tag electromagnético extra para mi segundo vehículo.',
      status: 'OPEN',
    },
  });

  // Initial Payment
  await prisma.payment.create({
    data: {
      residentId: resident.id,
      propertyId: property.id,
      concept: 'Cuota de Mantenimiento Agosto 2026',
      amount: 85.0,
      currency: 'USD',
      status: 'PENDING',
      dueDate: new Date('2026-08-30'),
    },
  });

  console.log('✅ Seeding complete!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
