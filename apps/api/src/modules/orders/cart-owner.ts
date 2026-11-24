import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { GUEST_TOKEN_HEADER, type AccessTokenPayload } from '@shop/shared';

/**
 * কার্টের মালিক — লগইন করা ইউজার, **নয়তো** গেস্ট।
 *
 * **কেন discriminated union, আলাদা দুটো ঐচ্ছিক মাঠ নয়:**
 * `{ userId?: string; guestToken?: string }` লিখলে "দুটোই আছে" আর
 * "কোনোটাই নেই" দুটো অবস্থাই টাইপে বৈধ হতো, অথচ দুটোই বাগ। তখন
 * `where: { userId: owner.userId }`-এ `undefined` চলে যেত আর Prisma
 * শর্তটাই বাদ দিয়ে **সবার** কার্ট ফেরত দিত — মানে এক ক্রেতা অন্যের
 * কার্ট দেখত। union-এ সেই অবস্থাগুলো লেখাই যায় না।
 */
export type CartOwner =
  | { readonly kind: 'user'; readonly userId: string }
  | { readonly kind: 'guest'; readonly guestToken: string };

/**
 * header-এ আসা গেস্ট টোকেন — **লগইন থাকলেও**।
 *
 * `resolveCartOwner` লগইন থাকলে টোকেন উপেক্ষা করে (সেটাই ঠিক),
 * কিন্তু কার্ট মেশানোর সময় দুটোই একসাথে দরকার: কোথায় মেশাব
 * (user) আর কোনটা মেশাব (guest token)। তাই আলাদা করে পড়া হয়।
 */
export const readGuestToken = (request: Request): string | null => {
  const header = request.headers[GUEST_TOKEN_HEADER];
  const value = Array.isArray(header) ? header[0] : header;

  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
};

/** Handler-এ `@GuestToken() token: string | null` হিসেবে আসে। */
export const GuestToken = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string | null =>
    readGuestToken(context.switchToHttp().getRequest<Request>()),
);

/**
 * request থেকে মালিক বের করা।
 *
 * **লগইন থাকলে গেস্ট header উপেক্ষা হয়** — ইচ্ছাকৃত। নইলে কেউ
 * নিজের টোকেনের সাথে অন্যের গেস্ট টোকেন পাঠিয়ে দুটো কার্ট মিশিয়ে
 * ফেলত, আর কোনটা কার সেটা আর বলা যেত না।
 *
 * দুটোর একটাও না থাকলে `null` — handler ঠিক করবে সেটা ত্রুটি কি না।
 * চেকআউটে ত্রুটি (কার কার্ট জানতেই হবে), কিন্তু `GET /cart`-এ নয়:
 * প্রথমবার আসা ক্রেতার কাছে এখনো টোকেন নেই, তাকে খালি কার্ট দেখানোই
 * সঠিক — ত্রুটি দিলে সাইট খোলার সাথেই ভাঙা দেখাত।
 */
export const resolveCartOwner = (request: Request): CartOwner | null => {
  const user = (request as Request & { user?: AccessTokenPayload }).user;

  if (user !== undefined) {
    return { kind: 'user', userId: user.sub };
  }

  const guestToken = readGuestToken(request);

  return guestToken === null ? null : { kind: 'guest', guestToken };
};

/** Handler-এ `@Owner() owner: CartOwner | null` হিসেবে আসে। */
export const Owner = createParamDecorator(
  (_data: unknown, context: ExecutionContext): CartOwner | null =>
    resolveCartOwner(context.switchToHttp().getRequest<Request>()),
);

/**
 * মালিক ধরে Prisma-র `where` — **একটাই জায়গা যেখানে এটা লেখা হয়**।
 *
 * প্রতি query-তে হাতে লিখলে কোথাও একটা ভুলে `userId: undefined`
 * চলে যেত আর সেই একটা জায়গা দিয়েই সব কার্ট ফাঁস হতো। এখানে union
 * exhaustive, তাই কম্পাইলারই নিশ্চিত করে দুটো অবস্থাই ঢাকা পড়েছে।
 */
export const cartWhere = (owner: CartOwner): Prisma.CartWhereUniqueInput =>
  owner.kind === 'user' ? { userId: owner.userId } : { guestToken: owner.guestToken };

/** `cart.create`-এর ডেটা — ঠিক একটা মাঠ বসে, কখনো দুটো নয়। */
export const cartCreateData = (owner: CartOwner): Prisma.CartCreateInput =>
  owner.kind === 'user' ? { user: { connect: { id: owner.userId } } } : { guestToken: owner.guestToken };
