import { Injectable, Logger } from '@nestjs/common';
import type { Courier, ShipmentStatus } from '@shop/shared';
import type {
  CancelResult,
  CourierProvider,
  DispatchResult,
  ParcelRequest,
  ProviderContext,
  TrackResult,
  WebhookUpdate,
} from '../courier.provider';
import { hmacMatches, headerValue } from '../webhook-guard';

/**
 * Steadfast Courier (portal.packzy.com)।
 *
 * তাদের merchant dashboard-এর API guide ধরে লেখা। **অনুমান করা
 * হয়নি** — যা ডকে নেই তা এখানেও নেই।
 *
 * **তিনটা জিনিস যা তাদের ডক থেকে শেখা, আর যা না জানলে ভুল হতো:**
 *
 * ১. `cod_amount` **টাকায়**, paisa-তে নয়। paisa পাঠালে কুরিয়ার
 *    ১০০ গুণ টাকা তুলতে যেত।
 *
 * ২. `delivered_approval_pending` **`delivered` নয়** — রাইডারের
 *    দাবি, তাদের হিসাব বিভাগের নিশ্চয়তা নয়। ডকে স্পষ্ট লেখা:
 *    "Do not settle your books on it"।
 *
 * ৩. একই `invoice` দুবার নেয় না। তাই পুনঃপ্রেরণে `parcelReference`
 *    যায়, অর্ডার নম্বর নয়।
 */

const BASE_URL = 'https://portal.packzy.com/api/v1';

/**
 * ডকে লেখা মাঠের সীমা। **আমরা আগেই কাটি**, নইলে তারা নিজে কেটে
 * দেয় — তখন আমাদের রেকর্ডে পুরোটা আর তাদের দিকে অর্ধেক, আর
 * ঠিকানা অর্ধেক হলে পার্সেল পৌঁছাত না।
 */
const LIMITS = {
  invoice: 100,
  recipientName: 100,
  recipientPhone: 40,
  recipientAddress: 490,
  note: 480,
} as const;

/**
 * যে অক্ষরগুলো Steadfast **নিজে মুছে দেয়** (ফাঁকা জায়গায় বদলে দেয়)।
 *
 * আমরা আগেই সরিয়ে পাঠাই, যাতে আমাদের রেকর্ড আর তাদের রেকর্ড এক
 * থাকে — অভিযোগের সময় কোনটা আসল তা বলা যায়।
 */
const STRIPPED = /[{};<>$]/g;

/**
 * তাদের অবস্থার নাম আমাদের নামে।
 *
 * **`_approval_pending`-গুলো `IN_TRANSIT`** — রাইডার কিছু বলেছে
 * কিন্তু নিশ্চিত হয়নি, তাই পার্সেল এখনো পথেই। `DELIVERED` ধরলে
 * অর্ডার সম্পন্ন দেখাত অথচ COD-র টাকা আসেনি।
 *
 * **`cancelled` → `RETURNED`, `CANCELLED` নয়** — ডকে লেখা "The
 * parcel comes back to you"। আমাদের `CANCELLED` মানে পাঠানোই
 * হয়নি; দুটো মিলিয়ে ফেললে ফেরত আসা পণ্য কেউ জানত না আর স্টকেও
 * যোগ হতো না।
 *
 * **`hold`, `exceptional`, `unknown` এখানে নেই, ইচ্ছাকৃতভাবে** —
 * ডকে তিনটাতেই "Contact support" লেখা। কোনো স্বাভাবিক অবস্থায়
 * map করলে অ্যাডমিন ভাবত সব ঠিক চলছে, অথচ পার্সেল আটকে আছে বা
 * হারিয়ে গেছে।
 */
const STATUS_MAP: Record<string, ShipmentStatus> = {
  pending: 'PENDING',
  in_review: 'PENDING',
  delivered_approval_pending: 'IN_TRANSIT',
  partial_delivered_approval_pending: 'IN_TRANSIT',
  cancelled_approval_pending: 'IN_TRANSIT',
  unknown_approval_pending: 'IN_TRANSIT',
  delivered: 'DELIVERED',
  partial_delivered: 'RETURNED',
  cancelled: 'RETURNED',
};

/** যেগুলোতে মানুষ লাগবে — ডকে "Contact support"। */
const NEEDS_SUPPORT = new Set(['hold', 'exceptional', 'unknown']);

@Injectable()
export class SteadfastProvider implements CourierProvider {
  private readonly logger = new Logger(SteadfastProvider.name);

  readonly kind: Courier = 'STEADFAST';
  readonly hasApi = true;

  async createParcel(
    request: ParcelRequest,
    context: ProviderContext,
  ): Promise<DispatchResult> {
    /**
     * ঠিকানায় শহর-জেলা জুড়ে দেওয়া হয় — Steadfast-এ আলাদা মাঠ নেই,
     * একটাই `recipient_address`। না জুড়লে রাইডার শুধু বাড়ির লাইনটা
     * দেখত আর কোন শহরে যাবে বুঝত না।
     */
    const fullAddress = [request.recipientAddress, request.recipientCity, request.recipientDistrict]
      .filter((part) => part !== '')
      .join(', ');

    const payload = {
      invoice: this.clean(request.parcelReference, LIMITS.invoice),
      recipient_name: this.clean(request.recipientName, LIMITS.recipientName),
      recipient_phone: this.clean(request.recipientPhone, LIMITS.recipientPhone),
      recipient_address: this.clean(fullAddress, LIMITS.recipientAddress),
      /**
       * **paisa → টাকা।**
       *
       * উপরের দিকে নেওয়া হয় (`ceil`): নিচে নিলে দোকান প্রতি অর্ডারে
       * এক টাকা পর্যন্ত কম পেত আর সেটা আর আদায় করা যেত না। উপরে
       * নিলে ক্রেতা সর্বোচ্চ এক টাকা বেশি দেয়, যা খুচরার দেশে
       * এমনিতেও হয়।
       */
      cod_amount: Math.ceil(request.codAmountPaisa / 100),
      note: this.clean(
        request.note ?? `${request.itemCount}টি পণ্য — ${request.itemDescription}`,
        LIMITS.note,
      ),
    };

    const response = await this.post('/create_order', payload, context);

    if (!response.ok) {
      return response.failure;
    }

    const consignment = this.readConsignment(response.body);

    if (consignment === null) {
      this.logger.error(
        `Steadfast booked nothing recognisable for ${request.parcelReference}: ${JSON.stringify(
          response.body,
        )}`,
      );

      return {
        ok: false,
        message: 'Steadfast-এর উত্তর বোঝা গেল না — সাপোর্টে যোগাযোগ করুন',
        retryable: false,
      };
    }

    return {
      ok: true,
      consignmentId: consignment.id,
      trackingCode: consignment.trackingCode,
      /**
       * `null` — Steadfast বুকিংয়ের সময় চার্জ জানায় না।
       *
       * ভুয়া সংখ্যা বসানোর চেয়ে `null` ভালো: অ্যাডমিন তখন জানে
       * হিসাবটা তাদের payout রিপোর্ট থেকে মেলাতে হবে।
       */
      feePaisa: null,
    };
  }

  async track(consignmentId: string, context: ProviderContext): Promise<TrackResult> {
    const response = await this.get(`/status_by_cid/${consignmentId}`, context);

    if (!response.ok) {
      return response.failure;
    }

    const raw = this.readDeliveryStatus(response.body);

    if (raw === null) {
      return {
        ok: false,
        message: 'Steadfast অবস্থা জানায়নি',
        retryable: true,
      };
    }

    /**
     * মানুষ লাগবে এমন অবস্থা — স্বাভাবিক কোনো status-এ map করা হয় না।
     *
     * কাঁচা নামটা বার্তায় রাখা হয় যাতে অ্যাডমিন সাপোর্টকে বলতে
     * পারে ঠিক কী দেখছে।
     */
    if (NEEDS_SUPPORT.has(raw)) {
      return {
        ok: false,
        message: `পার্সেলটা "${raw}" অবস্থায় — Steadfast সাপোর্টে যোগাযোগ করুন`,
        retryable: false,
      };
    }

    const status = STATUS_MAP[raw];

    if (status === undefined) {
      this.logger.warn(`Unknown Steadfast status "${raw}" for consignment ${consignmentId}`);

      return {
        ok: false,
        message: `Steadfast-এর নতুন অবস্থা "${raw}" — আপডেট দরকার`,
        retryable: false,
      };
    }

    return { ok: true, status, rawStatus: raw };
  }

  /**
   * **Steadfast-এ পার্সেল বাতিলের API নেই।**
   *
   * ডকে `create_return_request` আছে (পার্সেল ফেরত আনা), কিন্তু
   * সেটা বাতিল নয় — আর ভুল endpoint ডেকে "বাতিল হয়েছে" বলা
   * বিপদের: অ্যাডমিন ভাবত পার্সেল আটকানো গেছে, অথচ সেটা ক্রেতার
   * কাছে চলেই যেত।
   *
   * তাই স্পষ্ট করে বলা হয় কী করতে হবে।
   */
  cancel(): Promise<CancelResult> {
    return Promise.resolve({
      ok: false,
      message:
        'Steadfast-এ API দিয়ে বাতিল হয় না — তাদের প্যানেল থেকে return request দিন বা সাপোর্টে ফোন করুন',
      retryable: false,
    });
  }

  parseWebhook(
    body: unknown,
    headers: Record<string, string | string[] | undefined>,
    secret: string | null,
  ): WebhookUpdate | null {
    /**
     * **secret ছাড়া কিছুই নেওয়া হয় না।**
     *
     * নিলে যে কেউ "delivered" পাঠিয়ে অর্ডার সম্পন্ন দেখাত আর COD-র
     * টাকা না পেয়েই হিসাব মিলে যেত।
     */
    if (secret === null) {
      return null;
    }

    if (typeof body !== 'object' || body === null) {
      return null;
    }

    const signature = headerValue(headers, 'x-steadfast-signature');

    /**
     * HMAC **body-র JSON-এর উপর**।
     *
     * আদর্শভাবে কাঁচা body-তে হতো, কিন্তু Nest আগেই parse করে ফেলে।
     * মাঠের ক্রম বদলালে signature মিলবে না — সেটা মেনে নেওয়া
     * আপস, আর ঝুঁকিটা উল্টোদিকে: ভুয়া webhook ঢোকার বদলে আসল
     * webhook আটকাবে, যা অ্যাডমিন হাতে ঠিক করতে পারে।
     */
    if (!hmacMatches(JSON.stringify(body), signature, secret)) {
      return null;
    }

    const record = body as Record<string, unknown>;

    /**
     * ডেলিভারি ছাড়া অন্য notification (payout, return list) আমাদের
     * কাজে লাগে না — `null` ফেরালে controller ২০০ দেয় আর কুরিয়ার
     * retry করে না।
     */
    if (
      typeof record['notification_type'] === 'string' &&
      record['notification_type'] !== 'delivery_status'
    ) {
      return null;
    }

    const consignmentId = this.asId(record['consignment_id']);
    const raw = typeof record['delivery_status'] === 'string' ? record['delivery_status'] : null;

    if (consignmentId === null || raw === null) {
      return null;
    }

    const status = STATUS_MAP[raw];

    if (status === undefined) {
      // অজানা অবস্থা — অনুমান করলে টাকা না পেয়েই অর্ডার সম্পন্ন হতো
      this.logger.warn(`Ignoring unknown Steadfast webhook status "${raw}"`);

      return null;
    }

    const updatedAt = record['updated_at'];

    return {
      consignmentId,
      status,
      rawStatus: raw,
      occurredAt: typeof updatedAt === 'string' ? this.asDate(updatedAt) : null,
      note: null,
    };
  }

  /** ---------- ভেতরের সহায়ক ---------- */

  /**
   * মাঠ পরিষ্কার: যে অক্ষর তারা মুছে দেবে সেগুলো সরানো, তারপর কাটা।
   *
   * ক্রমটা গুরুত্বপূর্ণ — আগে কেটে পরে সরালে দৈর্ঘ্য সীমার নিচে
   * নেমে যেত আর ঠিকানার শেষ অংশ অকারণে হারাত।
   */
  private clean(value: string, limit: number): string {
    return value.replace(STRIPPED, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
  }

  private headers(context: ProviderContext): Record<string, string> {
    return {
      'Api-Key': context.credentials['apiKey'] ?? '',
      'Secret-Key': context.credentials['secretKey'] ?? '',
      'Content-Type': 'application/json',
    };
  }

  private post(
    path: string,
    payload: unknown,
    context: ProviderContext,
  ): Promise<SteadfastResponse> {
    return this.call(path, {
      method: 'POST',
      headers: this.headers(context),
      body: JSON.stringify(payload),
    });
  }

  private get(path: string, context: ProviderContext): Promise<SteadfastResponse> {
    return this.call(path, { method: 'GET', headers: this.headers(context) });
  }

  /**
   * HTTP কল আর ত্রুটির অনুবাদ — **এক জায়গায়**।
   *
   * প্রতিটা method নিজে করলে কোথাও `retryable` ভুল বসত, আর
   * তখন হয় অর্থহীন retry হতো, নয় সারানোর মতো ত্রুটিতেও হাল
   * ছেড়ে দেওয়া হতো।
   */
  private async call(path: string, init: RequestInit): Promise<SteadfastResponse> {
    let response: Response;

    try {
      response = await fetch(`${BASE_URL}${path}`, init);
    } catch (error) {
      /**
       * নেটওয়ার্ক ভাঙা — **retry করা যায়**।
       *
       * এখানে অর্ডার ব্যর্থ হয় কিন্তু পার্সেল তৈরি হয়ে থাকতে পারে।
       * ডকে লেখা একই invoice দুবার নেয় না, তাই retry-তে দুবার বুক
       * হওয়ার ভয় নেই।
       */
      this.logger.error(
        `Steadfast unreachable at ${path}: ${error instanceof Error ? error.message : 'unknown'}`,
      );

      return {
        ok: false,
        failure: {
          ok: false,
          message: 'Steadfast-এ পৌঁছানো গেল না — আবার চেষ্টা করুন',
          retryable: true,
        },
      };
    }

    const body: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      return { ok: false, failure: this.translateError(response.status, body) };
    }

    /**
     * **২০০-র ভেতরেও ব্যর্থতা থাকতে পারে** — ডকে স্পষ্ট লেখা:
     * "Some endpoints report a per-item failure inside a 200 —
     * always read the body."
     *
     * শুধু HTTP কোড দেখলে পার্সেল তৈরি হয়নি অথচ আমরা সফল ধরে
     * অর্ডার `SHIPPED` করে দিতাম, আর কেউ পণ্যটা নিতেই আসত না।
     */
    const inner = this.readInnerStatus(body);

    if (inner !== null && inner >= 400) {
      return { ok: false, failure: this.translateError(inner, body) };
    }

    return { ok: true, body };
  }

  /**
   * তাদের HTTP কোড আমাদের বার্তায়।
   *
   * **`retryable` সঠিক হওয়া জরুরি।** ডকে লেখা: একই ঠিকানা থেকে
   * ৫ মিনিটে ১০ বার ভুল key দিলে **৬০ মিনিট** আটকে যায়, ঠিক key
   * দিলেও। তাই ৪০১-এ কখনো retry নয় — নইলে key ঠিক করার পরেও
   * দোকান এক ঘণ্টা পার্সেল পাঠাতে পারত না।
   */
  private translateError(status: number, body: unknown): {
    ok: false;
    message: string;
    retryable: boolean;
  } {
    if (status === 401) {
      return {
        ok: false,
        message: 'Steadfast-এর API key ভুল বা বাতিল — প্যানেল থেকে নতুন key বসান',
        retryable: false,
      };
    }

    if (status === 403) {
      return {
        ok: false,
        message: 'Steadfast অ্যাকাউন্ট নিষ্ক্রিয় বা KYC অসম্পূর্ণ — তাদের সাথে যোগাযোগ করুন',
        retryable: false,
      };
    }

    if (status === 422) {
      return { ok: false, message: this.fieldErrors(body), retryable: false };
    }

    if (status === 429) {
      return {
        ok: false,
        message: 'Steadfast-এ অনেক বেশি অনুরোধ গেছে — কিছুক্ষণ পর আবার চেষ্টা করুন',
        retryable: true,
      };
    }

    if (status >= 500) {
      /**
       * তাদের দোষ — retry করা যায়। ডকে লেখা: "Retry with the same
       * invoice; duplicate invoices are refused, so a retry cannot
       * double-book."
       */
      return {
        ok: false,
        message: 'Steadfast-এর সার্ভারে সমস্যা — আবার চেষ্টা করুন',
        retryable: true,
      };
    }

    return {
      ok: false,
      message: this.messageFrom(body) ?? `Steadfast ${status} দিয়েছে`,
      retryable: false,
    };
  }

  /**
   * কোন মাঠ কী কারণে বাতিল হলো।
   *
   * মাঠের নাম রাখা হয় (`recipient_phone`), কারণ অ্যাডমিনকে জানতে
   * হবে কোথায় ঠিক করতে হবে। শুধু "validation error" বললে সে
   * অর্ডারের সব মাঠ হাতড়াত।
   */
  private fieldErrors(body: unknown): string {
    if (typeof body !== 'object' || body === null) {
      return 'Steadfast তথ্য নেয়নি';
    }

    const errors = (body as Record<string, unknown>)['errors'];

    if (typeof errors !== 'object' || errors === null) {
      return this.messageFrom(body) ?? 'Steadfast তথ্য নেয়নি';
    }

    const parts: string[] = [];

    for (const [field, messages] of Object.entries(errors)) {
      const first = Array.isArray(messages) ? messages[0] : messages;

      parts.push(`${field}: ${String(first)}`);
    }

    return parts.length === 0 ? 'Steadfast তথ্য নেয়নি' : parts.join('; ');
  }

  private messageFrom(body: unknown): string | null {
    if (typeof body !== 'object' || body === null) {
      return null;
    }

    const message = (body as Record<string, unknown>)['message'];

    return typeof message === 'string' ? message : null;
  }

  private readInnerStatus(body: unknown): number | null {
    if (typeof body !== 'object' || body === null) {
      return null;
    }

    const status = (body as Record<string, unknown>)['status'];

    return typeof status === 'number' ? status : null;
  }

  private readConsignment(body: unknown): { id: string; trackingCode: string | null } | null {
    if (typeof body !== 'object' || body === null) {
      return null;
    }

    const consignment = (body as Record<string, unknown>)['consignment'];

    if (typeof consignment !== 'object' || consignment === null) {
      return null;
    }

    const record = consignment as Record<string, unknown>;
    const id = this.asId(record['consignment_id']);

    if (id === null) {
      return null;
    }

    const tracking = record['tracking_code'];

    return { id, trackingCode: typeof tracking === 'string' && tracking !== '' ? tracking : null };
  }

  private readDeliveryStatus(body: unknown): string | null {
    if (typeof body !== 'object' || body === null) {
      return null;
    }

    const status = (body as Record<string, unknown>)['delivery_status'];

    return typeof status === 'string' ? status.trim().toLowerCase() : null;
  }

  /**
   * `consignment_id` সংখ্যা হিসেবে আসে, আমরা string-এ রাখি।
   *
   * DB-র কলাম `TEXT`, কারণ অন্য কুরিয়ারের আইডি অক্ষর-সংখ্যা মেশানো।
   * সংখ্যা রাখলে প্রতিটা কুরিয়ারে আলাদা কলাম লাগত।
   */
  private asId(value: unknown): string | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }

    return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
  }

  private asDate(value: string): Date | null {
    const parsed = new Date(value);

    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
}

/** HTTP কলের ফল — সফল হলে body, নইলে অনুবাদ করা ত্রুটি। */
type SteadfastResponse =
  | { ok: true; body: unknown }
  | { ok: false; failure: { ok: false; message: string; retryable: boolean } };
