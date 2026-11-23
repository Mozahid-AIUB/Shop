import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { HealthResponse } from '@shop/shared';
import { Public } from '../modules/auth/decorators/public.decorator';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  // uptime monitor লগইন করতে পারে না — এটা খোলা থাকতেই হবে
  @Public()
  @Get()
  async check(@Res() res: Response): Promise<void> {
    const result: HealthResponse = await this.health.check();

    // DB down হলে 503 — load balancer / uptime monitor এই কোড দেখেই সিদ্ধান্ত নেয়
    const status = result.status === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE;
    res.status(status).json(result);
  }
}
