import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { MulterExceptionFilter } from './multer-exception.filter';

function corsOrigin(): boolean | string | string[] {
  const raw = process.env.FRONTEND_ORIGIN?.trim();
  if (!raw) return true;
  if (raw === '*') return true;
  if (raw.includes(',')) {
    return raw
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);
  }
  return raw;
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new MulterExceptionFilter());
  app.enableCors({ origin: corsOrigin(), credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('File manager API')
    .setDescription('REST API with Supabase; use Bearer demo token or Supabase JWT')
    .setVersion('1.0')
    .addBearerAuth()
    .addApiKey({ type: 'apiKey', name: 'X-User-Id', in: 'header' }, 'X-User-Id')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  const port = process.env.PORT ?? 4000;
  await app.listen(port);
}
bootstrap();
