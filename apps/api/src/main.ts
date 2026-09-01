import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';

/** Собирает и запускает production HTTP-приложение NestJS. */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  // Helmet добавляет безопасные HTTP-заголовки; CSP отключена из-за встроенного Swagger UI.
  app.use(helmet({ contentSecurityPolicy: false }));
  // Middleware присваивает correlation id и пишет один структурированный JSON-лог на запрос.
  app.use((request: Request, response: Response, next: NextFunction) => {
    const requestId = request.header('x-request-id') ?? randomUUID();
    const startedAt = Date.now();
    response.setHeader('x-request-id', requestId);
    // Событие finish гарантирует, что в лог попадёт фактический HTTP-статус и длительность.
    response.on('finish', () =>
      console.info(
        JSON.stringify({
          level: 'info',
          message: 'http_request',
          requestId,
          method: request.method,
          path: request.path,
          statusCode: response.statusCode,
          durationMs: Date.now() - startedAt,
          timestamp: new Date().toISOString(),
        }),
      ),
    );
    next();
  });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  app.enableShutdownHooks();

  const config = new DocumentBuilder()
    .setTitle('Fullstack Test Shop API')
    .setDescription('Idempotent ordering, payment inbox, delivery queue and recovery API')
    .setVersion('1.0.0')
    .addApiKey({ type: 'apiKey', in: 'header', name: 'X-Admin-Token' }, 'admin')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  // Одна и та же схема доступна человеку через Swagger и автоматике как JSON.
  SwaggerModule.setup('api/docs', app, document);
  app
    .getHttpAdapter()
    .getInstance()
    .get('/api/openapi.json', (_request: Request, response: Response) => response.json(document));

  const webRoot = join(process.cwd(), 'public');
  if (existsSync(webRoot)) {
    // Production-контейнер отдаёт собранный Angular с того же origin, что и API.
    app.useStaticAssets(webRoot);
    app.use((request: Request, response: Response, next: NextFunction) => {
      // Не маскируем API и запросы реальных файлов SPA fallback'ом.
      if (request.path.startsWith('/api') || request.path.includes('.')) return next();
      response.sendFile(join(webRoot, 'index.html'));
    });
  }

  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port, '0.0.0.0');
  Logger.log(`API listening on ${port}`, 'Bootstrap');
}

// `void` явно показывает линтеру, что promise запуска приложения обработан точкой входа.
void bootstrap();
