import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Global `JwtAuthGuard` থেকে এই route-কে বাদ দেয়।
 * লগইন ছাড়াই যেগুলো খোলা থাকবে — `/health`, `/auth/login`, order tracking।
 */
export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(IS_PUBLIC_KEY, true);
