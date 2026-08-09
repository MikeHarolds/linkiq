import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.useLogger(app.get(Logger));

  // API_PREFIX already carries the version segment (e.g. "api/v1"), so we
  // deliberately do NOT also call app.enableVersioning(URI) — combining
  // both previously produced a hidden double-versioned path
  // (/api/v1/v1/...) that the real server actually listened on while
  // every doc, env example, and Docker config referenced /api/v1/...
  // instead. One source of truth for the version segment: this prefix.
  const configPrefix = process.env.API_PREFIX ?? 'api/v1';
  app.setGlobalPrefix(configPrefix);

  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',') ?? '*',
    credentials: true,
  });

  // Strip unknown properties and transform payloads to DTO instances.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('LinkIQ API')
    .setDescription(
      'Public and internal REST API for the LinkIQ link management platform.',
    )
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup(`${configPrefix}/docs`, app, swaggerDocument, {
    swaggerOptions: { persistAuthorization: true },
  });

  const port = process.env.PORT ?? 4000;
  await app.listen(port);
}

bootstrap();
