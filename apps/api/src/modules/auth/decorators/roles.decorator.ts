import { SetMetadata } from '@nestjs/common';
import type { Role } from '@shop/shared';

export const ROLES_KEY = 'roles';

/**
 * এই route শুধু নির্দিষ্ট role-এর জন্য। `RolesGuard` এটা পড়ে।
 * কিছু না দিলে যেকোনো লগইন করা ইউজার ঢুকতে পারবে।
 */
export const Roles = (...roles: Role[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);
