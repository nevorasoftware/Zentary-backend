import { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Sembrando datos de prueba en la base de datos PostgreSQL...');

  // Hash password
  const hashedPassword = await bcrypt.hash('zentary123', 10);

  // 1. Create Property
  const property = await prisma.property.create({
    data: {
      unitNumber: 'Apt 502',
      block: 'Torre B',
    },
  });

  // 2. Create Admin User
  const admin = await prisma.user.create({
    data: {
      email: 'admin@zentary.com',
      password: hashedPassword,
      fullName: 'Administrador Zentary',
      phone: '+503 7000-0000',
      role: Role.ADMIN,
      isActive: true,
      avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150',
    },
  });

  // 3. Create Resident User
  const resident = await prisma.user.create({
    data: {
      email: 'residente@zentary.com',
      password: hashedPassword,
      fullName: 'María Camila Rodríguez',
      phone: '+503 7888-9999',
      role: Role.RESIDENT,
      isActive: true,
      propertyId: property.id,
      avatarUrl: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150',
    },
  });

  // 4. Create Initial Announcement
  await prisma.announcement.create({
    data: {
      title: '¡Bienvenidos a Zentary Residencial!',
      body: 'La plataforma de control de accesos y servicios residenciales está oficialmente activa.',
      category: 'GENERAL',
      authorId: admin.id,
    },
  });

  console.log('✅ Base de datos inicializada con éxito.');
  console.log('👤 Admin: admin@zentary.com / zentary123');
  console.log('👤 Residente: residente@zentary.com / zentary123');
}

main()
  .catch((e) => {
    console.error('❌ Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
