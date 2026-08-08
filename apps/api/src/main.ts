import { ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.useLogger(app.get(Logger));

  const configPrefix = process.env.API_PREFIX ?? 'api/v1';
  app.setGlobalPrefix(configPrefix);
  app.enableVersioning({ type: VersioningType.URI });

  app.use(helmet());
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
