import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { type NestExpressApplication } from '@nestjs/platform-express';
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
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    rawBody: true,
  });

  // Serves uploaded branding assets (logo/favicon — see
  // modules/branding/storage/local-disk-storage.provider.ts) at
  // /uploads/*. No new dependency: useStaticAssets ships with
  // @nestjs/platform-express, already installed. Registered before
  // setGlobalPrefix so these URLs stay unprefixed (SiteBranding.logoUrl
  // is stored — and rendered by the frontend — as a plain "/uploads/..."
  // path, not "/api/v1/uploads/...").
  app.useStaticAssets(
    app.get(ConfigService).get<string>('branding.uploadDir')!,
    {
      prefix: '/uploads',
    },
  );

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
  // Sprint 19 — CORS_ORIGIN is the single source of truth across every
  // environment (local Windows, Codespaces, Render): comma-separated
  // when more than one frontend origin must be allowed (e.g. a
  // Codespaces forwarded-port URL alongside a Render staging URL). No
  // wildcard fallback — "*" combined with credentials:true is both
  // rejected by browsers and a bad default to ever silently fall back
  // to; an unset CORS_ORIGIN falls back to the local dev origin only,
  // never to "allow everything."
  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',').map((o) => o.trim()) ?? [
      'http://localhost:3000',
    ],
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
