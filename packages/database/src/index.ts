import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { shopPrisma?: PrismaClient };

export const prisma =
  globalForPrisma.shopPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.shopPrisma = prisma;

export * from '@prisma/client';
