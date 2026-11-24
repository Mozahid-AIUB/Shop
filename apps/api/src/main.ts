import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger as PinoLogger } from 'nestjs-pino';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  // bufferLogs — pino তৈরি হওয়ার আগের log-ও ধরা পড়বে
  // `NestExpressApplication` — `app.set('trust proxy', ...)` Express-এর নিজের
  // method, সাধারণ `INestApplication`-এ সেটা নেই
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService);

  // Nest-এর নিজের logger-এর বদলে pino — structured, request id সহ
  app.useLogger(app.get(PinoLogger));

  /**
   * নিরাপত্তা header। এই সার্ভার শুধু JSON দেয়, কোনো HTML নয়,
   * তাই CSP কড়া রাখা যায় — `default-src 'none'` মানে কোনো
   * resource লোড করার অনুমতি নেই।
   *
   * ভুলেও যদি কোনো endpoint HTML ফেরত দেয়, browser সেটা
   * চালাতে পারবে না — stored XSS-এর পথ বন্ধ।
   */
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      // API-তে ব্রাউজার থেকে সরাসরি রেফারার পাঠানোর দরকার নেই
      referrerPolicy: { policy: 'no-referrer' },
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );

  // refresh token httpOnly cookie-তে আসে — এটা ছাড়া `request.cookies` ফাঁকা থাকে
  app.use(cookieParser());

  /**
   * reverse proxy-র পিছনে আসল ক্লায়েন্ট IP `x-forwarded-for`-এ আসে।
   * এটা না বললে rate limit সব request-কে proxy-র এক IP ধরত আর
   * একজনের সীমা ছাড়ালে সবাই আটকে যেত।
   *
   * শুধু production-এ: dev-এ proxy নেই, আর বিশ্বাস করলে যে কেউ
   * header পাঠিয়ে নিজের IP লুকিয়ে সীমা এড়াতে পারত।
   */
  if (config.get<string>('NODE_ENV') === 'production') {
    app.set('trust proxy', 1);
  }

  app.enableCors({
    origin: config.get<string>('WEB_ORIGIN', 'http://localhost:3000'),
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = Number(config.get<string>('API_PORT', '4000'));
  await app.listen(port);
}

void bootstrap();
