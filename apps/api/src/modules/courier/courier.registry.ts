import { BadRequestException, Injectable } from '@nestjs/common';
import type { Courier } from '@shop/shared';
import type { CourierProvider } from './courier.provider';
import { ManualProvider } from './providers/manual.provider';
import { PathaoProvider } from './providers/pathao.provider';
import { RedxProvider } from './providers/redx.provider';
import { SteadfastProvider } from './providers/steadfast.provider';

/**
 * কোন কুরিয়ারের জন্য কোন adapter।
 *
 * **কেন আলাদা class, সরাসরি `switch` নয়:** নতুন কুরিয়ার যোগ করতে
 * শুধু এখানে একটা লাইন লাগে। `switch` ছড়িয়ে থাকলে একটা জায়গা
 * ভুলে গেলে ওই কুরিয়ারে সব ঠিক দেখাত অথচ কাজ করত না।
 *
 * **`MANUAL` key ছাড়াই চলে**, তাই যে দোকান এখনো কুরিয়ারের সাথে
 * চুক্তি করেনি সেও আজই অর্ডার পাঠাতে পারে।
 *
 * **Steadfast** তাদের merchant dashboard-এর API guide ধরে লেখা।
 * Pathao, RedX আর Carrybee বাকি — প্রত্যেকের auth আলাদা আর আসল
 * ডকুমেন্টেশন merchant dashboard-এ থাকে। অনুমান করে লিখলে key
 * বসানোর পর ব্যর্থ হতো আর বোঝা যেত না ভুলটা key-তে না কোডে।
 */
@Injectable()
export class CourierRegistry {
  private readonly providers: Map<Courier, CourierProvider>;

  constructor(
    manual: ManualProvider,
    steadfast: SteadfastProvider,
    pathao: PathaoProvider,
    redx: RedxProvider,
  ) {
    this.providers = new Map<Courier, CourierProvider>([
      [manual.kind, manual],
      [steadfast.kind, steadfast],
      [pathao.kind, pathao],
      [redx.kind, redx],
    ]);
  }

  /**
   * adapter না থাকলে **স্পষ্ট বার্তা**।
   *
   * `undefined` ফেরালে ডাকার জায়গায় চেক ভুলে গেলে অদ্ভুত crash
   * হতো। এখানে বার্তাটা অ্যাডমিনকে বলে দেয় কী করতে হবে।
   */
  get(kind: Courier): CourierProvider {
    const provider = this.providers.get(kind);

    if (provider === undefined) {
      throw new BadRequestException(
        `${kind}-এর সংযোগ এখনো তৈরি হয়নি — এখন "নিজের ডেলিভারি" ব্যবহার করুন`,
      );
    }

    return provider;
  }

  /** প্যানেল দেখায় কোনগুলো সত্যিই কাজ করবে। */
  isSupported(kind: Courier): boolean {
    return this.providers.has(kind);
  }
}
