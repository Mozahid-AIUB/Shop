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
import { translateHttpError, unreachable, type CourierFailure } from '../http-errors';
import { headerValue, secretMatches } from '../webhook-guard';

/**
 * RedX (OpenAPI)।
 *
 * তাদের developer documentation ধরে লেখা। **অনুমান করা হয়নি।**
 *
 * **অন্য দুটোর চেয়ে আলাদা তিন জায়গায়:**
 *
 * ১. **`delivery_area_id` বাধ্যতামূলক** — আমাদের ঠিকানায় শুধু
 *    জেলার নাম, তাদের আইডি নেই। `/areas` থেকে মেলাতে হয়, আর
 *    তালিকাটা ক্যাশ করা হয় (প্রায় বদলায় না)।
 *
 * ২. **webhook-এ signature নেই** — ডকে লেখা, credential
 *    **query parameter**-এ আসে (`?token=xxx`)।
 *
 * ৩. **বাতিল করা যায়** — একমাত্র কুরিয়ার যার API-তে এটা আছে
 *    (`PATCH /parcels`)।
 */

const SANDBOX_URL = 'https://sandbox.redx.com.bd/v1.0.0-beta';
const LIVE_URL = 'https://openapi.redx.com.bd/v1.0.0-beta';

/**
 * তাদের অবস্থার নাম আমাদের নামে।
 *
 * ডকের "Status Updates and Meanings" টেবিল থেকে।
 *
 * **`agent-hold` আর `agent-area-change` এখানে নেই, ইচ্ছাকৃতভাবে** —
 * দুটোতেই মানুষের নজর দরকার (একটায় পার্সেল আটকে, আরেকটায় এলাকা
 * বদলের অনুরোধ চলছে)। স্বাভাবিক অবস্থায় map করলে অ্যাডমিন ভাবত
 * পার্সেল চলছে।
 *
 * **`paid` এখানে নেই** — ওটা কুরিয়ারের টাকা পরিশোধের ঘটনা,
 * পার্সেলের গতি নয়। পার্সেলের অবস্থায় বসালে `DELIVERED`-কে ছাপিয়ে
 * যেত আর ইতিহাস বিভ্রান্তিকর হতো।
 */
const STATUS_MAP: Record<string, ShipmentStatus> = {
  'pickup-pending': 'PENDING',
  'ready-for-delivery': 'PICKED_UP',
  'delivery-in-progress': 'IN_TRANSIT',
  delivered: 'DELIVERED',
  'agent-returning': 'RETURNED',
  returned: 'RETURNED',
  cancelled: 'CANCELLED',
};

/** মানুষ লাগবে এমন অবস্থা — ডকের টেবিল অনুযায়ী। */
const NEEDS_ATTENTION = new Set(['agent-hold', 'agent-area-change']);

/** টাকার ঘটনা, পার্সেলের গতি নয়। */
const NOT_A_MOVEMENT = new Set(['paid']);

@Injectable()
export class RedxProvider implements CourierProvider {
  private readonly logger = new Logger(RedxProvider.name);

  readonly kind: Courier = 'REDX';
  readonly hasApi = true;

  /**
   * জেলার নাম → `delivery_area_id`, ক্যাশ করা।
   *
   * **কেন ক্যাশ:** এরিয়ার তালিকা প্রায় বদলায় না, আর প্রতি পার্সেলে
   * আনলে বাড়তি একটা কল যেত। মেমরিতে রাখা যথেষ্ট — সার্ভার
   * রিস্টার্টে আবার আনা হবে, আর সেটা একবারের খরচ।
   *
   * DB-তে রাখা হয়নি ইচ্ছাকৃতভাবে: তাহলে তালিকা বাসি হলে কেউ
   * বুঝত না, আর নতুন এলাকা যোগ হলে পুরোনো আইডি নিয়ে বসে থাকতাম।
   */
  private readonly areaCache = new Map<string, number>();

  async createParcel(
    request: ParcelRequest,
    context: ProviderContext,
  ): Promise<DispatchResult> {
    const area = await this.resolveArea(request.recipientDistrict, context);

    if (!area.ok) {
      return area.failure;
    }

    const storeId = Number(context.credentials['pickupStoreId']);

    if (!Number.isFinite(storeId) || storeId <= 0) {
      return {
        ok: false,
        message: 'RedX-এর Pickup Store ID ঠিক নেই — প্যানেল থেকে আবার বসান',
        retryable: false,
      };
    }

    /**
     * পণ্যের দাম — পার্সেল হারালে এই অঙ্কে ক্ষতিপূরণ।
     *
     * COD ০ হলেও (আগে পেমেন্ট হয়ে গেছে) দাম ০ নয়, নইলে হারালে
     * কিছুই পাওয়া যেত না। COD থাকলে সেটাই দাম হিসেবে যথেষ্ট কাছাকাছি।
     */
    const declaredValue = Math.max(Math.ceil(request.codAmountPaisa / 100), 1);

    const payload = {
      customer_name: request.recipientName,
      customer_phone: request.recipientPhone,
      delivery_area: area.name,
      delivery_area_id: area.id,
      customer_address: this.fullAddress(request),
      merchant_invoice_id: request.parcelReference,
      /** paisa → টাকা। `ceil` — নিচে নিলে দোকান কম পেত */
      cash_collection_amount: String(Math.ceil(request.codAmountPaisa / 100)),
      /** ডকে লেখা "in grams" — আমাদের দিকেও গ্রামে, তাই ভাগ করার কিছু নেই */
      parcel_weight: String(request.weightGrams),
      value: String(declaredValue),
      /**
       * ক্রেতা টাকা দেওয়ার আগে খুলে দেখতে পারবে কি না — **অ্যাডমিনের
       * সিদ্ধান্ত**, কারণ পণ্যভেদে ঠিক উত্তর আলাদা।
       *
       * খুলে দেখতে দিলে বিশ্বাস বাড়ে আর ভুল পণ্য তখনই ধরা পড়ে।
       * কিন্তু কাস্টম ছাপা বা সিল করা পণ্যে উল্টো ক্ষতি: ফেরত এলে
       * সেটা আর কাউকে বেচা যায় না।
       *
       * `undefined` হলে **খুলে দেখতে দেওয়া** — বেশিরভাগ দোকানে
       * সেটাই ঠিক, আর নতুন দোকানে ক্রেতার বিশ্বাসই সবচেয়ে বড় বাধা।
       */
      is_closed_box: context.allowOpenBox === false,
      pickup_store_id: storeId,
      ...(request.note === null ? {} : { instruction: request.note }),
    };

    const response = await this.call('/parcel', { method: 'POST', body: payload }, context);

    if (!response.ok) {
      return response.failure;
    }

    const trackingId = this.asText(this.record(response.body)?.['tracking_id']);

    if (trackingId === null) {
      this.logger.error(
        `RedX booked nothing recognisable for ${request.parcelReference}: ${JSON.stringify(
          response.body,
        )}`,
      );

      return {
        ok: false,
        message: 'RedX-এর উত্তর বোঝা গেল না — তাদের সাপোর্টে যোগাযোগ করুন',
        retryable: false,
      };
    }

    return {
      ok: true,
      consignmentId: trackingId,
      trackingCode: trackingId,
      /**
       * `null` — RedX বুকিংয়ের সময় চার্জ জানায় না।
       *
       * `/charge/charge_calculator` আছে, কিন্তু সেটা আলাদা কল আর
       * আগাম হিসাব — আসল বিল তাদের payout রিপোর্টে। ভুয়া সংখ্যা
       * বসানোর চেয়ে `null` ভালো।
       */
      feePaisa: null,
    };
  }

  async track(consignmentId: string, context: ProviderContext): Promise<TrackResult> {
    const response = await this.call(`/parcel/info/${consignmentId}`, { method: 'GET' }, context);

    if (!response.ok) {
      return response.failure;
    }

    const parcel = this.record(this.record(response.body)?.['parcel']);
    const raw = this.asText(parcel?.['status']);

    if (raw === null) {
      return { ok: false, message: 'RedX অবস্থা জানায়নি', retryable: true };
    }

    const mapped = this.mapStatus(raw);

    if (mapped === null) {
      return {
        ok: false,
        message: NEEDS_ATTENTION.has(raw.toLowerCase())
          ? `পার্সেলটা "${raw}" অবস্থায় — RedX-এর সাথে যোগাযোগ করুন`
          : `RedX-এর অবস্থা "${raw}" চেনা গেল না — প্যানেল থেকে দেখুন`,
        retryable: false,
      };
    }

    return { ok: true, status: mapped, rawStatus: raw };
  }

  /**
   * পার্সেল বাতিল — **RedX-এ এটা সত্যিই করা যায়**।
   *
   * অন্য দুই কুরিয়ারে API-তে বাতিল নেই, তাই এখানে `ok: true`
   * ফেরানোর মানে সত্যিই বাতিল হয়েছে।
   */
  async cancel(consignmentId: string, context: ProviderContext): Promise<CancelResult> {
    const response = await this.call(
      '/parcels',
      {
        method: 'PATCH',
        body: {
          entity_type: 'parcel-tracking-id',
          entity_id: consignmentId,
          update_details: {
            property_name: 'status',
            new_value: 'cancelled',
            reason: 'দোকান থেকে বাতিল',
          },
        },
      },
      context,
    );

    if (!response.ok) {
      return response.failure;
    }

    /**
     * **`success: false` এলে ব্যর্থ — ২০০ হলেও।**
     *
     * শুধু HTTP কোড দেখলে অ্যাডমিন ভাবত পার্সেল আটকানো গেছে, অথচ
     * সেটা ক্রেতার কাছে চলেই যেত (পাঠানো হয়ে গেলে বাতিল হয় না)।
     */
    const body = this.record(response.body);

    if (body?.['success'] === false) {
      return {
        ok: false,
        message: this.asText(body['message']) ?? 'RedX পার্সেলটা বাতিল করতে পারেনি',
        retryable: false,
      };
    }

    return { ok: true };
  }

  parseWebhook(
    body: unknown,
    headers: Record<string, string | string[] | undefined>,
    secret: string | null,
  ): WebhookUpdate | null {
    if (secret === null || typeof body !== 'object' || body === null) {
      return null;
    }

    /**
     * **RedX signature পাঠায় না** — ডকে লেখা, credential
     * **query parameter**-এ আসে: `https://example.com/callback?token=xxx`।
     *
     * controller query-টা `x-query-token` নামে পাস করে, যাতে
     * adapter-কে express-এর request object জানতে না হয়।
     *
     * তুলনা সময়-নিরপেক্ষ, নইলে উত্তরের সময় মেপে অক্ষর ধরে ধরে
     * token অনুমান করা যেত।
     */
    if (!secretMatches(headerValue(headers, 'x-query-token'), secret)) {
      return null;
    }

    const record = body as Record<string, unknown>;
    const consignmentId = this.asText(record['tracking_number']);
    const raw = this.asText(record['status']);

    if (consignmentId === null || raw === null) {
      return null;
    }

    const status = this.mapStatus(raw);

    if (status === null) {
      // অজানা, আটকে থাকা, বা টাকার ঘটনা — কোনোটাই পার্সেলের গতি নয়
      this.logger.warn(`Ignoring RedX webhook status "${raw}"`);

      return null;
    }

    const timestamp = this.asText(record['timestamp']);

    return {
      consignmentId,
      status,
      rawStatus: raw,
      occurredAt: timestamp === null ? null : this.asDate(timestamp),
      /** বাংলা বার্তাটা রাখা হয় — অ্যাডমিন সেটাই পড়ে */
      note: this.asText(record['message_bn']) ?? this.asText(record['message_en']),
    };
  }

  /** ---------- এরিয়া ---------- */

  /**
   * জেলার নাম থেকে তাদের `delivery_area_id`।
   *
   * **না মিললে স্পষ্ট প্রত্যাখ্যান, অনুমান নয়।** যেকোনো একটা আইডি
   * বসিয়ে দিলে পার্সেল ভুল এলাকায় চলে যেত আর ক্রেতা পণ্য পেত না —
   * অথচ আমাদের দিকে সব ঠিক দেখাত।
   */
  private async resolveArea(
    district: string,
    context: ProviderContext,
  ): Promise<{ ok: true; id: number; name: string } | { ok: false; failure: CourierFailure }> {
    const key = district.trim().toLowerCase();
    const cached = this.areaCache.get(key);

    if (cached !== undefined) {
      return { ok: true, id: cached, name: district };
    }

    const response = await this.call(
      `/areas?district_name=${encodeURIComponent(district)}`,
      { method: 'GET' },
      context,
    );

    if (!response.ok) {
      return { ok: false, failure: response.failure };
    }

    const areas = this.record(response.body)?.['areas'];

    if (!Array.isArray(areas) || areas.length === 0) {
      return {
        ok: false,
        failure: {
          ok: false,
          message: `RedX "${district}" জেলায় ডেলিভারি করে না — অন্য কুরিয়ার বাছুন`,
          retryable: false,
        },
      };
    }

    /**
     * তালিকার প্রথমটা নেওয়া হয়।
     *
     * **সীমাবদ্ধতা, জেনে রাখা দরকার:** এক জেলায় অনেক এরিয়া থাকে
     * (ঢাকায় শতাধিক), আর ঠিকানা মিলিয়ে সঠিকটা বাছা আমাদের কাজ নয় —
     * সেটা করতে ঠিকানা পার্স করতে হতো, যা বানান ভুলে ভেঙে পড়ে।
     *
     * RedX নিজে `customer_address` দেখে রুট ঠিক করে; `delivery_area_id`
     * মূলত জোন/চার্জ হিসাবের জন্য। তাই জেলার যেকোনো এরিয়া কাজ চালায়।
     * ভুল হলে তাদের দিকেই ধরা পড়বে, আর `lastError`-এ জমা থাকবে।
     */
    const first = this.record(areas[0]);
    const id = first?.['id'];
    const name = this.asText(first?.['name']) ?? district;

    if (typeof id !== 'number') {
      return {
        ok: false,
        failure: {
          ok: false,
          message: 'RedX-এর এরিয়ার তালিকা বোঝা গেল না',
          retryable: true,
        },
      };
    }

    this.areaCache.set(key, id);

    return { ok: true, id, name };
  }

  /** ---------- HTTP ---------- */

  private async call(
    path: string,
    options: { method: 'GET' | 'POST' | 'PATCH'; body?: unknown },
    context: ProviderContext,
  ): Promise<{ ok: true; body: unknown } | { ok: false; failure: CourierFailure }> {
    const baseUrl = context.isSandbox ? SANDBOX_URL : LIVE_URL;

    let response: Response;

    try {
      response = await fetch(`${baseUrl}${path}`, {
        method: options.method,
        headers: {
          /** ডকে লেখা আকার — `Authorization` নয়, তাদের নিজের header */
          'API-ACCESS-TOKEN': `Bearer ${context.credentials['accessToken'] ?? ''}`,
          'Content-Type': 'application/json',
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      });
    } catch (error) {
      this.logger.error(
        `RedX unreachable at ${path}: ${error instanceof Error ? error.message : 'unknown'}`,
      );

      return { ok: false, failure: unreachable('RedX') };
    }

    const body: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      return { ok: false, failure: translateHttpError(response.status, body, 'RedX') };
    }

    return { ok: true, body };
  }

  /** ---------- ছোট সহায়ক ---------- */

  /**
   * অবস্থার অনুবাদ — অজানা, আটকে থাকা আর টাকার ঘটনায় `null`।
   *
   * তিনটা আলাদা কারণ একই উত্তর দেয়, কারণ তিনটাতেই করার কিছু নেই:
   * পার্সেল যেমন ছিল তেমনই থাকে আর কাঁচা মান জমা হয়।
   */
  private mapStatus(raw: string): ShipmentStatus | null {
    const key = raw.trim().toLowerCase();

    if (NEEDS_ATTENTION.has(key) || NOT_A_MOVEMENT.has(key)) {
      return null;
    }

    return STATUS_MAP[key] ?? null;
  }

  /** শহর-জেলা জুড়ে দেওয়া — RedX ঠিকানা দেখে রুট ঠিক করে। */
  private fullAddress(request: ParcelRequest): string {
    return [request.recipientAddress, request.recipientCity, request.recipientDistrict]
      .filter((part) => part.trim() !== '')
      .join(', ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private record(value: unknown): Record<string, unknown> | null {
    return typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)
      : null;
  }

  private asText(value: unknown): string | null {
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
