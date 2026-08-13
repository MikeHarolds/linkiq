import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { registerRedirectRoute } from './modules/links/redirect-route';

async function bootstrap(): Promise<void> {
  // rawBody: true preserves the exact request bytes on req.rawBody
  // alongside Nest's normal parsed req.body — needed by
  // PaystackWebhookController to verify the x-paystack-signature header
  // against the true raw bytes (see paystack-signature.service.ts's docs
  // on why a re-JSON.stringify'd body isn't safe to sign/verify against).
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    rawBody: true,
  });

  app.useLogger(app.get(Logger));

  // Registered FIRST, before any of Nest's own routing middleware is
  // mounted (that happens during app.init()/app.listen() below). Express
  // checks middleware/routes in registration order, and Nest's router
  // responds to an unmatched path with its own 404 rather than yielding
  // to anything registered afterward — so this MUST come before
  // setGlobalPrefix and before Nest's controllers are wired up, or it's
  // never reached (verified empirically: registering it after app.init()
  // resulted in Nest's own "Cannot GET /whatever" 404 every time). The
  // route pattern itself (a single path segment, /:shortCode) can't
  // collide with any /api/v1/* route since those have more segments.
  registerRedirectRoute(app);

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
