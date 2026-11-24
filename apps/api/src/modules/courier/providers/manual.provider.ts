import { Injectable } from '@nestjs/common';
import type { Courier } from '@shop/shared';
import type {
  CancelResult,
  CourierProvider,
  DispatchResult,
  TrackResult,
  WebhookUpdate,
} from '../courier.provider';

/**
 * নিজের ডেলিভারি — কোনো API নেই।
 *
 * **কেন এটা সবার আগে লেখা:** এই কোড অন্য ব্যবসায়ীদের কাছেও যাবে।
 * তাদের Steadfast বা Pathao-র সাথে চুক্তি হতে দিন-সপ্তাহ লাগে।
 * `MANUAL` না থাকলে ততদিন সাইটই অচল থাকত — অর্ডার নিতে পারত, কিন্তু
 * "পাঠানো হয়েছে" বলার কোনো উপায় থাকত না।
 *
 * ছোট দোকানে এটাই আসল পথ: নিজের লোক পণ্য নিয়ে যায়, অ্যাডমিন
 * প্যানেলে হাতে অবস্থা বদলায়। কোনো key লাগে না, কোনো চুক্তি লাগে না।
 */
@Injectable()
export class ManualProvider implements CourierProvider {
  readonly kind: Courier = 'MANUAL';

  /**
   * `false` — তাই প্যানেল "কুরিয়ারে পাঠান" বাটন দেখাবে না, বরং
   * ট্র্যাকিং নম্বর বসানোর ঘর দেখাবে।
   */
  readonly hasApi = false;

  /**
   * পার্সেল "তৈরি" — আসলে কোথাও কিছু পাঠানো হয় না।
   *
   * `consignmentId` আমাদের নিজের অর্ডার নম্বর, কারণ কুরিয়ারের
   * দেওয়া কোনো আইডি নেই। এতে `Shipment` row-র আকার সব কুরিয়ারে
   * একই থাকে আর বাকি কোডে `MANUAL`-এর জন্য আলাদা শর্ত লাগে না।
   */
  createParcel(request: { orderNumber: string }): Promise<DispatchResult> {
    return Promise.resolve({
      ok: true,
      consignmentId: request.orderNumber,
      /**
       * `null` — ট্র্যাকিং নম্বর অ্যাডমিন হাতে বসাবে (যদি বসায়)।
       *
       * এখানে অর্ডার নম্বর বসিয়ে দিলে ক্রেতা ভাবত ওটা কুরিয়ারের
       * নম্বর আর কোথাও খুঁজতে যেত।
       */
      trackingCode: null,
      /** নিজের লোকের খরচ হিসাব করা হয় না — সেটা দোকানের ভেতরের ব্যাপার */
      feePaisa: null,
    });
  }

  /**
   * ট্র্যাক করার কিছু নেই — কাউকে জিজ্ঞেস করার নেই।
   *
   * `retryable: false`, কারণ আবার চেষ্টা করলেও একই উত্তর আসবে।
   * `true` দিলে cron বারবার চেষ্টা করত অর্থহীনভাবে।
   */
  track(): Promise<TrackResult> {
    return Promise.resolve({
      ok: false,
      message: 'নিজের ডেলিভারিতে ট্র্যাকিং নেই — প্যানেল থেকে অবস্থা বদলান',
      retryable: false,
    });
  }

  /**
   * বাতিল সফল — কারণ বাতিল করার মানে শুধু "আমরা পাঠাব না"।
   *
   * কুরিয়ারকে কিছু বলার নেই, তাই ব্যর্থ হওয়ার কিছুই নেই। `false`
   * ফেরালে অ্যাডমিন পার্সেল বাতিলই করতে পারত না।
   */
  cancel(): Promise<CancelResult> {
    return Promise.resolve({ ok: true });
  }

  /** webhook পাঠানোর কেউ নেই। */
  parseWebhook(): WebhookUpdate | null {
    return null;
  }
}
