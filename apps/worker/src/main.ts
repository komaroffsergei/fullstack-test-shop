import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

/** Запускает NestJS application context без HTTP-сервера для фонового worker'а. */
async function bootstrap(): Promise<void> {
  await NestFactory.createApplicationContext(AppModule);
}

// Контекст остаётся жить, пока NestJS не получит сигнал завершения процесса.
void bootstrap();
