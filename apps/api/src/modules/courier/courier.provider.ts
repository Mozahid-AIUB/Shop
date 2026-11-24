import type { Courier, ShipmentStatus } from '@shop/shared';

/**
 * কুরিয়ারের সাথে কথা বলার চুক্তি।
 *
 * **কেন interface:** চারটা কুরিয়ারের API একেবারে আলাদা — Steadfast-এ
 * দুটো static key, Pathao-তে OAuth (টোকেনের মেয়াদ শেষ হয়), RedX-এ
 * একটা JWT, Carrybee-তে client id + secret + context। সেই পার্থক্য
 * adapter-এর ভেতরে থাকলে বাকি কোড (অ্যাডমিন প্যানেল, অর্ডারের
 * জীবনচক্র, রিপোর্ট) কোন কুরিয়ার সেটা জানতেই হয় না।
 *
 * **কোনো adapter throw করে না।** ফল সবসময় `DispatchResult` —
 * সফল বা ব্যর্থ, দুটোই একটা উত্তর। throw করলে প্রতিটা ডাকার
 * জায়গায় try/catch লাগত, আর কোথাও ভুলে গেলে পুরো অ্যাডমিন পাতা
 * ৫০০ দিত শুধু এক কুরিয়ার বন্ধ থাকার জন্য।
 */

/** পার্সেল বানাতে কুরিয়ারকে যা দিতে হয় — সবই অর্ডার থেকে পড়া। */
export type ParcelRequest = {
  /** আমাদের অর্ডার নম্বর — কুরিয়ারের প্যানেলে এটাই দেখা যাবে */
  orderNumber: string;

  /**
   * এই **পার্সেলের** নিজের reference — অর্ডারের নয়।
   *
   * **কেন আলাদা:** কুরিয়াররা একই invoice দুবার নেয় না (Steadfast
   * স্পষ্ট করে refuse করে)। ফেরত আসা পার্সেল আবার পাঠাতে গেলে
   * অর্ডার নম্বর একই থাকে, তাই তারা না বলত — আর দোকান পণ্যটা আর
   * পাঠাতেই পারত না।
   *
   * প্রথম পার্সেলে এটা অর্ডার নম্বরই; দ্বিতীয়টায় `-R2`, তৃতীয়তে
   * `-R3`। তাই কুরিয়ারের প্যানেলে দেখেই বোঝা যায় কোনটা পুনঃপ্রেরণ।
   */
  parcelReference: string;

  recipientName: string;
  recipientPhone: string;
  /** পুরো ঠিকানা এক লাইনে — কুরিয়াররা সাধারণত এভাবেই নেয় */
  recipientAddress: string;
  recipientCity: string;
  recipientDistrict: string;

  /**
   * কুরিয়ার কত টাকা তুলবে, **paisa**।
   *
   * `0` = আগেই পেমেন্ট হয়ে গেছে, শুধু পৌঁছে দিতে হবে। adapter
   * নিজের API-র একক অনুযায়ী ভাগ করে নেবে (অনেকে টাকায় চায়)।
   */
  codAmountPaisa: number;

  itemCount: number;
  /** "2 x শার্ট (L, কালো)" বা "1 x হেডফোন" — কুরিয়ারের লোক বুঝে নেয় */
  itemDescription: string;

  /**
   * পুরো পার্সেলের ওজন, **গ্রামে**।
   *
   * কুরিয়াররা ওজন **বাধ্যতামূলক** চায় আর সেটা ধরে চার্জ করে, তাই
   * ভুল ওজন মানে ভুল বিল। গ্রামে রাখা হয় কারণ RedX গ্রামে চায় আর
   * Pathao কেজিতে — adapter নিজের একক অনুযায়ী ভাগ করে নেয়।
   *
   * পণ্যে ওজন লেখা না থাকলে কুরিয়ার সেটআপের ডিফল্ট ব্যবহার হয়, তাই
   * এই মাঠ কখনো `null` হয় না — `0`-ও নয়, কারণ কুরিয়ার ০ ওজনে
   * পার্সেল নেয় না।
   */
  weightGrams: number;

  note: string | null;
};

/** পার্সেল বানানোর ফল। */
export type DispatchResult =
  | {
      ok: true;
      /** কুরিয়ারের দেওয়া আইডি — পরে ট্র্যাক/বাতিল করতে লাগে */
      consignmentId: string;
      /** ক্রেতাকে দেখানোর নম্বর। কিছু কুরিয়ারে এটাই `consignmentId` */
      trackingCode: string | null;
      /** কুরিয়ারের চার্জ, paisa। না জানলে `null` */
      feePaisa: number | null;
    }
  | {
      ok: false;
      /**
       * অ্যাডমিনকে দেখানোর বার্তা।
       *
       * কুরিয়ারের কাঁচা উত্তর নয় — সেটা সাধারণত ইংরেজি JSON আর
       * দোকানের লোক পড়ে কিছু বুঝত না। adapter বাংলায় অনুবাদ করে
       * দেয়, আর কাঁচা মান `lastError`-এ জমা থাকে।
       */
      message: string;
      /** আবার চেষ্টা করলে কাজ হতে পারে কিনা (নেটওয়ার্ক vs ভুল key) */
      retryable: boolean;
    };

/** ট্র্যাক করার ফল। */
export type TrackResult =
  | { ok: true; status: ShipmentStatus; rawStatus: string | null }
  | { ok: false; message: string; retryable: boolean };

/** বাতিলের ফল। */
export type CancelResult = { ok: true } | { ok: false; message: string; retryable: boolean };

/**
 * webhook-এর শরীর থেকে যা বোঝা গেল।
 *
 * `null` = এই webhook আমাদের কাজে লাগে না (অজানা ঘটনা, বা অন্য
 * কিছুর জন্য পাঠানো)। তখন ২০০ ফেরানো হয় কিন্তু কিছু করা হয় না —
 * ত্রুটি দিলে কুরিয়ার বারবার retry করত।
 */
export type WebhookUpdate = {
  consignmentId: string;
  status: ShipmentStatus;
  rawStatus: string | null;
  occurredAt: Date | null;
  note: string | null;
};

/**
 * credential — adapter-এর নিজের মাঠ।
 *
 * `Record<string, string>` কারণ মাঠগুলো কুরিয়ারভেদে আলাদা।
 * কোন মাঠ লাগে সেটা `COURIER_CREDENTIAL_FIELDS`-এ লেখা আছে, আর
 * schema সেটা ধরে যাচাই করে — তাই adapter-এ পৌঁছানোর সময়
 * মাঠগুলো থাকার নিশ্চয়তা আছে।
 */
export type CourierCredentials = Record<string, string>;

export type ProviderContext = {
  credentials: CourierCredentials;
  /** sandbox হলে adapter টেস্ট URL ব্যবহার করবে */
  isSandbox: boolean;

  /**
   * ক্রেতা টাকা দেওয়ার আগে পার্সেল খুলে দেখতে পারবে কি না।
   *
   * **পণ্যভেদে ঠিক উত্তর আলাদা, তাই এটা অ্যাডমিনের সিদ্ধান্ত:**
   *
   * - মোবাইল/ইলেকট্রনিক্সে **দরকার** — না দেখে কেউ বড় অঙ্ক দেয় না
   * - কাস্টম ছাপা পণ্যে **ক্ষতিকর** — "পছন্দ হয়নি" বলে ফেরত দিলে
   *   সেটা আর কাউকে বেচা যায় না
   * - খাবার/প্রসাধনীতে ক্ষতিকর — সিল ভাঙলে আর বিক্রি হয় না
   *
   * এখন শুধু RedX-এর API-তে এই সুইচ আছে; বাকিরা উপেক্ষা করে।
   */
  allowOpenBox?: boolean;

  /**
   * জমানো OAuth টোকেন (এনক্রিপ্ট খোলা অবস্থায়), বা `null`।
   *
   * **কেন adapter নিজে DB-তে যায় না:** তাহলে প্রতিটা adapter-এ
   * Prisma আর এনক্রিপশন ঢুকত, আর টেস্ট করতে DB লাগত। এখানে
   * টোকেনটা দেওয়া-নেওয়ার কাজ service-এর, আর adapter শুধু বলে
   * "এটা রাখো"।
   *
   * static key-ওয়ালা কুরিয়ারে (Steadfast) অব্যবহৃত।
   */
  oauthToken?: string | null;

  /**
   * নতুন টোকেন জমা রাখা।
   *
   * adapter এটা ডাকে টোকেন ইস্যু বা refresh করার পর। service
   * এনক্রিপ্ট করে DB-তে লেখে, তাই সার্ভার রিস্টার্ট হলেও টোকেন
   * থাকে — আর একাধিক সার্ভার চালালে সবাই একটাই টোকেন ব্যবহার করে।
   */
  saveOauthToken?: (token: string) => Promise<void>;
};

export interface CourierProvider {
  readonly kind: Courier;

  /**
   * এই কুরিয়ারে সত্যিই API আছে কিনা।
   *
   * `MANUAL`-এ `false` — তখন ট্র্যাকিং নম্বর অ্যাডমিন হাতে বসায়
   * আর অবস্থাও হাতে বদলায়। এটা জানা জরুরি, নইলে প্যানেল
   * `MANUAL`-এও "কুরিয়ারে পাঠান" বাটন দেখাত যা কিছুই করত না।
   */
  readonly hasApi: boolean;

  createParcel(request: ParcelRequest, context: ProviderContext): Promise<DispatchResult>;

  track(consignmentId: string, context: ProviderContext): Promise<TrackResult>;

  cancel(consignmentId: string, context: ProviderContext): Promise<CancelResult>;

  /**
   * webhook যাচাই ও পড়া।
   *
   * **signature যাচাই adapter-এর কাজ**, কারণ প্রত্যেকে আলাদাভাবে
   * করে (কেউ HMAC header, কেউ body-তে token)। যাচাই ব্যর্থ হলে
   * `null` ফেরে আর controller ৪০১ দেয়।
   *
   * `secret` `null` হলে **সবসময় `null` ফেরে** — secret ছাড়া
   * webhook খোলা দরজা: যে কেউ "DELIVERED" পাঠিয়ে অর্ডার ডেলিভারড
   * দেখাত, আর COD-র টাকা না পেয়েই হিসাব মিলে যেত।
   */
  parseWebhook(
    body: unknown,
    headers: Record<string, string | string[] | undefined>,
    secret: string | null,
  ): WebhookUpdate | null;
}
