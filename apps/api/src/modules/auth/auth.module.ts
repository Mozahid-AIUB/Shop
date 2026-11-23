import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';

/**
 * JwtModule-এ secret দেওয়া হয়নি ইচ্ছাকৃতভাবে — `TokenService` প্রতিবার
 * `ConfigService` থেকে নেয় আর না পেলে থ্রো করে। এতে secret ছাড়া
 * চুপচাপ চলে যাওয়ার সুযোগ থাকে না।
 */
@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, TokenService],
  exports: [AuthService, TokenService],
})
export class AuthModule {}
