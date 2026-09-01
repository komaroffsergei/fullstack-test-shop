import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

/** Запускает HTTP-заглушку поставщика на настроенном порту. */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(Number(process.env.PORT ?? 4101), '0.0.0.0');
}

// Один и тот же entrypoint используется контейнерами provider-a и provider-b.
void bootstrap();
