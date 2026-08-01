import { Injectable, Logger } from '@nestjs/common';
import type { HealthResponse } from '@tshirt/shared';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(private readonly prisma: PrismaService) {}

  async check(): Promise<HealthResponse> {
    let db: HealthResponse['db'] = 'up';

    try {
      await this.prisma.ping();
    } catch (error) {
      db = 'down';
      this.logger.error('Database ping failed', error instanceof Error ? error.stack : String(error));
    }

    return {
      status: db === 'up' ? 'ok' : 'error',
      db,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }
}
