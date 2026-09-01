import { PrismaClient } from '@prisma/client';

// Один числовой ключ синхронизирует demo reset и короткие worker claims без блокировки таблиц.
export const DEMO_RESET_ADVISORY_LOCK_ID = 1_947_208_314;

// В development повторная загрузка модуля не должна создавать новый пул соединений Prisma.
const globalForPrisma = globalThis as unknown as { shopPrisma?: PrismaClient };

// Один экспортируемый клиент является общей точкой доступа всех приложений к PostgreSQL.
export const prisma =
  globalForPrisma.shopPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

// В production модуль загружается один раз, а локально сохраняем клиент между hot reload.
if (process.env.NODE_ENV !== 'production') globalForPrisma.shopPrisma = prisma;

export * from '@prisma/client';
export * from './demo-data.js';
