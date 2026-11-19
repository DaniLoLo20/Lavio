import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const origin = process.env.CORS_ORIGIN ?? '*';
  app.enableCors({ origin: origin === '*' ? true : origin.split(','), credentials: true });

  // Comprobantes de caja: privados (solo con sesion via /api/cash/movements/:id/evidence), nunca como archivo estatico
  app.use('/api/uploads', (req: any, res: any, next: any) => (/(^|\/)cash(\/|$)/.test(req.path) ? res.status(404).end() : next()));

  // Fotografias: volumen persistente /storage/uploads
  app.useStaticAssets(process.env.UPLOAD_DIR || '/storage/uploads', {
    prefix: '/api/uploads',
    maxAge: '7d',
    index: false,
    dotfiles: 'deny',
  });

  const doc = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Lavio API')
      .setVersion('1.0')
      .addBearerAuth()
      .build(),
  );
  SwaggerModule.setup('api/docs', app, doc);

  await app.listen(process.env.PORT || 3001, '0.0.0.0');
}
bootstrap();
