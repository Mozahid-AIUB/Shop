import { SetMetadata } from '@nestjs/common';

export const IS_OPTIONAL_AUTH_KEY = 'isOptionalAuth';

/**
 * টোকেন থাকলে যাচাই করো, না থাকলেও route চলবে।
 *
 * **`@Public()` দিয়ে এটা করা যায় না।** `@Public()`-এ guard টোকেন
 * দেখেই না, তাই `/cart`-কে public করলে লগইন করা ইউজারের টোকেনও
 * উপেক্ষা হতো আর সে নিজের কার্ট হারাত। এখানে তিনটা অবস্থা দরকার:
 * সুরক্ষিত, খোলা, আর "যে আছে তাকে চিনে নাও"।
 *
 * **ভুল টোকেন তবুও প্রত্যাখ্যাত হয়** — মেয়াদ শেষ হওয়া টোকেন নিয়ে
 * আসা ক্রেতাকে চুপচাপ গেস্ট বানিয়ে দিলে সে নিজের কার্ট খালি দেখে
 * বুঝত না কী হলো। আর হাতে একটা চুরি করা টোকেন থাকলে সেটা অচল
 * হয়েছে কি না জানাই যেত না।
 */
export const OptionalAuth = (): MethodDecorator & ClassDecorator =>
  SetMetadata(IS_OPTIONAL_AUTH_KEY, true);
