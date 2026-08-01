import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('GET /health', () => {
  describe('when the database is reachable', () => {
    let app: INestApplication;

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();

      // logger বন্ধ — db-down কেসে ইচ্ছাকৃত error log টেস্ট আউটপুট নোংরা করে
      app = moduleRef.createNestApplication({ logger: false });
      await app.init();
    });

    afterAll(async () => {
      await app.close();
    });

    it('responds 200 with db marked up', async () => {
      const response = await request(app.getHttpServer()).get('/health').expect(200);

      expect(response.body).toMatchObject({ status: 'ok', db: 'up' });
      expect(typeof response.body.uptime).toBe('number');
      expect(Number.isNaN(Date.parse(response.body.timestamp))).toBe(false);
    });
  });

  describe('when the database is unreachable', () => {
    let app: INestApplication;

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(PrismaService)
        .useValue({
          onModuleInit: jest.fn(),
          onModuleDestroy: jest.fn(),
          ping: jest.fn().mockRejectedValue(new Error('connection refused')),
        })
        .compile();

      // logger বন্ধ — db-down কেসে ইচ্ছাকৃত error log টেস্ট আউটপুট নোংরা করে
      app = moduleRef.createNestApplication({ logger: false });
      await app.init();
    });

    afterAll(async () => {
      await app.close();
    });

    // এটাই আসল পরীক্ষা — DB বন্ধ থাকলেও 200 বললে health check অর্থহীন
    it('responds 503 with db marked down', async () => {
      const response = await request(app.getHttpServer()).get('/health').expect(503);

      expect(response.body).toMatchObject({ status: 'error', db: 'down' });
    });
  });
});
