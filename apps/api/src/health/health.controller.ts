import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import type { HealthResponse } from '@shop/shared';
import { SKIP_ALL_THROTTLERS } from '../common/throttle.config';
import { Public } from '../modules/auth/decorators/public.decorator';
import { HealthService } from './health.service';

/**
 * `@SkipThrottle()` — uptime monitor প্রতি কয়েক সেকেন্ডে ডাকে।
 * সীমা বসালে monitor নিজেই ৪২৯ পেয়ে "সাইট ডাউন" অ্যালার্ম দিত,
 * অথচ সাইট ঠিকই চলছে।
 *
 * এটা ফাঁস নয়: উত্তরে শুধু "db up/down" আর uptime থাকে, কোনো
 * ব্যক্তিগত বা ব্যবসায়িক তথ্য নেই।
 */
@SkipThrottle(SKIP_ALL_THROTTLERS)
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
