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
import { translateHttpError, unreachable } from '../http-errors';
import { headerValue, secretMatches } from '../webhook-guard';
import {
  isUsable,
  issueToken,
  readStoredToken,
  type TokenResult,
} from './pathao-token';

/**
 * Pathao Courier (Merchant API)।
 *
 * তাদের developer documentation ধরে লেখা। **অনুমান করা হয়নি।**
 *
 * **Steadfast-এর চেয়ে কঠিন তিন কারণে:**
 *
 * ১. **OAuth** — প্রতিটা কলে key পাঠানো যায় না। আগে
 *    `/issue-token` ডেকে টোকেন নিতে হয়, মেয়াদ ৫ দিন। টোকেন DB-তে
 *    এনক্রিপ্ট করে জমা থাকে, নইলে প্রতিটা পার্সেলে দুটো কল লাগত
 *    আর সার্ভার রিস্টার্টে টোকেন হারাত।
 *
 * ২. **ওজন কেজিতে, float** — আমাদের দিকে গ্রামে integer। তাদের
 *    সীমা ০.৫ থেকে ১০ কেজি, আর সেটা মানা জরুরি।
 *
 * ৩. **`store_id` বাধ্যতামূলক** — কোন ঠিকানা থেকে পিকআপ হবে।
 *    অ্যাডমিন সেটআপে বসায়; তাদের `/stores` থেকে পাওয়া যায়।
 */

const SANDBOX_URL = 'https://courier-api-sandbox.pathao.com';
const LIVE_URL = 'https://api-hermes.pathao.com';

/** ডকে লেখা: `48` = Normal, `12` = On Demand (অনেক দামি)। */
const DELIVERY_TYPE_NORMAL = 48;

/** ডকে লেখা: `1` = Document, `2` = Parcel। */
const ITEM_TYPE_PARCEL = 2;

/** ডকে লেখা সীমা। */
const MIN_WEIGHT_KG = 0.5;
const MAX_WEIGHT_KG = 10;
const MIN_ADDRESS_LENGTH = 10;
const MAX_ADDRESS_LENGTH = 220;
const MAX_NAME_LENGTH = 100;

/**
 * তাদের অবস্থার নাম আমাদের নামে।
 *
 * **`Return`/`Returned` → `RETURNED`, `CANCELLED` নয়।** আমাদের
 * `CANCELLED` মানে পাঠানোই হয়নি; মিলিয়ে ফেললে ফেরত আসা পণ্য কেউ
 * জানত না আর স্টকেও যোগ হতো না।
 *
 * **"Hold"/"Exception" এখানে নেই, ইচ্ছাকৃতভাবে** — মানুষের নজর
 * দরকার। স্বাভাবিক অবস্থায় map করলে অ্যাডমিন ভাবত সব ঠিক চলছে।
 */
const STATUS_MAP: Record<string, ShipmentStatus> = {
  pending: 'PENDING',
  'pickup requested': 'PENDING',
  'assigned for pickup': 'PENDING',
  'picked': 'PICKED_UP',
  'pickup': 'PICKED_UP',
  'at the sorting hub': 'IN_TRANSIT',
  'in transit': 'IN_TRANSIT',
  'received at last mile hub': 'IN_TRANSIT',
  'assigned for delivery': 'IN_TRANSIT',
  delivered: 'DELIVERED',
  'partial delivery': 'RETURNED',
  'partial_delivery': 'RETURNED',
  return: 'RETURNED',
  returned: 'RETURNED',
  'delivery failed': 'RETURNED',
};

@Injectable()
export class PathaoProvider implements CourierProvider {
  private readonly logger = new Logger(PathaoProvider.name);

  readonly kind: Courier = 'PATHAO';
  readonly hasApi = true;

  async createParcel(
    request: ParcelRequest,
    context: ProviderContext,
  ): Promise<DispatchResult> {
    const weight = this.weightKg(request.weightGrams);

    if (weight === null) {
      /**
       * **ভারী পার্সেল কম ওজন দেখিয়ে পাঠানো হয় না।**
       *
       * ১০ কেজিতে নামিয়ে পাঠালে Pathao কম বিল করত, কিন্তু রাইডার
       * ২০ কেজির পার্সেল তুলতে গিয়ে ফিরে যেত — আর দোষটা আমাদের
       * দিকেই আসত। স্পষ্ট প্রত্যাখ্যানই সৎ।
       */
      return {
        ok: false,
        message: `পার্সেলটা ${(request.weightGrams / 1000).toFixed(1)} কেজি — Pathao সর্বোচ্চ ১০ কেজি নেয়। ভাগ করে পাঠান বা অন্য কুরিয়ার বাছুন`,
        retryable: false,
      };
    }

    const storeId = Number(context.credentials['storeId']);

    if (!Number.isFinite(storeId) || storeId <= 0) {
      return {
        ok: false,
        message: 'Pathao-র Store ID ঠিক নেই — প্যানেল থেকে আবার বসান',
        retryable: false,
      };
    }

    const payload = {
      store_id: storeId,
      merchant_order_id: request.parcelReference,
      recipient_name: this.clamp(request.recipientName, MAX_NAME_LENGTH),
      recipient_phone: request.recipientPhone,
      recipient_address: this.address(request),
      delivery_type: DELIVERY_TYPE_NORMAL,
      item_type: ITEM_TYPE_PARCEL,
      item_quantity: Math.max(request.itemCount, 1),
      item_weight: weight.toFixed(2),
      item_description: this.clamp(request.itemDescription, 500),
      /** paisa → টাকা। `ceil` — নিচে নিলে দোকান কম পেত */
      amount_to_collect: Math.ceil(request.codAmountPaisa / 100),
      ...(request.note === null ? {} : { special_instruction: this.clamp(request.note, 200) }),
      /**
       * **`recipient_city`/`zone`/`area` পাঠানো হয় না**, ইচ্ছাকৃতভাবে।
       *
       * ডকে লেখা: না পাঠালে তারা ঠিকানা দেখে নিজে বের করে নেয়।
       * আমরা জোরে বসালে ভুল জোন দিলে পার্সেল ভুল হাবে চলে যেত, আর
       * তাদের নিজের মেলানো আমাদের অনুমানের চেয়ে ভালো। ডকে সতর্কতাও
       * আছে: "do not send a null value"।
       */
    };

    const response = await this.authed('/aladdin/api/v1/orders', 'POST', payload, context);

    if (!response.ok) {
      return response.failure;
    }

    const data = this.readData(response.body);
    const consignmentId = this.asText(data?.['consignment_id']);

    if (consignmentId === null) {
      this.logger.error(
        `Pathao booked nothing recognisable for ${request.parcelReference}: ${JSON.stringify(
          response.body,
        )}`,
      );

      return {
        ok: false,
        message: 'Pathao-র উত্তর বোঝা গেল না — তাদের সাপোর্টে যোগাযোগ করুন',
        retryable: false,
      };
    }

    const fee = data?.['delivery_fee'];

    return {
      ok: true,
      consignmentId,
      /**
       * `null` — Pathao আলাদা tracking code দেয় না, consignment id
       * দিয়েই ক্রেতা ট্র্যাক করে। service ওটাই দেখায়।
       */
      trackingCode: consignmentId,
      // টাকা → paisa, কারণ আমাদের সব হিসাব paisa-তে
      feePaisa: typeof fee === 'number' && Number.isFinite(fee) ? Math.round(fee * 100) : null,
    };
  }

  async track(consignmentId: string, context: ProviderContext): Promise<TrackResult> {
    const response = await this.authed(
      `/aladdin/api/v1/orders/${consignmentId}/info`,
      'GET',
      null,
      context,
    );

    if (!response.ok) {
      return response.failure;
    }

    const data = this.readData(response.body);
    const raw =
      this.asText(data?.['order_status_slug']) ?? this.asText(data?.['order_status']);

    if (raw === null) {
      return { ok: false, message: 'Pathao অবস্থা জানায়নি', retryable: true };
    }

    const status = STATUS_MAP[raw.toLowerCase()];

    if (status === undefined) {
      this.logger.warn(`Unknown Pathao status "${raw}" for consignment ${consignmentId}`);

      return {
        ok: false,
        message: `Pathao-র অবস্থা "${raw}" চেনা গেল না — প্যানেল থেকে দেখুন`,
        retryable: false,
      };
    }

    return { ok: true, status, rawStatus: raw };
  }

  /**
   * **Pathao-র merchant API-তে বাতিলের endpoint নেই।**
   *
   * ডকে `Update Parcel` নেই, শুধু তৈরি/তথ্য/এরিয়া/দাম। ভুল
   * endpoint ডেকে "বাতিল হয়েছে" বলা বিপদের: অ্যাডমিন ভাবত পার্সেল
   * আটকানো গেছে, অথচ সেটা ক্রেতার কাছে চলেই যেত।
   */
  cancel(): Promise<CancelResult> {
    return Promise.resolve({
      ok: false,
      message: 'Pathao-তে API দিয়ে বাতিল হয় না — তাদের merchant প্যানেল বা হটলাইন ব্যবহার করুন',
      retryable: false,
    });
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
     * Pathao HMAC পাঠায় না — একটা শেয়ার করা key পাঠায় header-এ।
     *
     * তুলনা সময়-নিরপেক্ষ (`secretMatches`), নইলে উত্তরের সময় মেপে
     * অক্ষর ধরে ধরে key অনুমান করা যেত।
     */
    const given = headerValue(headers, 'x-pathao-signature');

    if (!secretMatches(given, secret)) {
      return null;
    }

    const record = body as Record<string, unknown>;
    const consignmentId = this.asText(record['consignment_id']);
    const raw = this.asText(record['order_status']) ?? this.asText(record['event']);

    if (consignmentId === null || raw === null) {
      return null;
    }

    const status = STATUS_MAP[raw.toLowerCase()];

    if (status === undefined) {
      // অজানা অবস্থা — অনুমান করলে টাকা না পেয়েই অর্ডার সম্পন্ন হতো
      this.logger.warn(`Ignoring unknown Pathao webhook status "${raw}"`);

      return null;
    }

    const updatedAt = this.asText(record['updated_at']);

    return {
      consignmentId,
      status,
      rawStatus: raw,
      occurredAt: updatedAt === null ? null : this.asDate(updatedAt),
      note: null,
    };
  }

  /** ---------- OAuth ---------- */

  /**
   * কাজের টোকেন — জমানোটা চললে সেটাই, নইলে নতুন।
   *
   * বিস্তারিত `pathao-token.ts`-এ; এখানে শুধু adapter-এর নিজের
   * `call()` পাস করা হয়, যাতে sandbox/live URL আর ত্রুটির অনুবাদ
   * এক জায়গাতেই থাকে।
   */
  private token(context: ProviderContext, force = false): Promise<TokenResult> {
    if (!force) {
      const stored = readStoredToken(context.oauthToken);

      if (isUsable(stored)) {
        return Promise.resolve({ ok: true, accessToken: stored.accessToken });
      }
    }

    return issueToken(context, (path, init) => this.call(path, init, context));
  }

  /**
   * টোকেন নিয়ে কল, আর টোকেন অচল হলে **একবার** আবার চেষ্টা।
   *
   * একবারই — নইলে credential সত্যিই ভুল হলে অসীম লুপ হতো। আর
   * retry না করলে অ্যাডমিন অকারণে ব্যর্থতা দেখত, অথচ শুধু টোকেনটা
   * পুরোনো ছিল (৫ দিন পর যা স্বাভাবিক)।
   */
  private async authed(
    path: string,
    method: 'GET' | 'POST',
    payload: unknown,
    context: ProviderContext,
  ): Promise<PathaoResponse> {
    const first = await this.token(context);

    if (!first.ok) {
      return { ok: false, failure: first.failure };
    }

    const send = (accessToken: string): Promise<PathaoResponse> =>
      this.call(
        path,
        {
          method,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          ...(payload === null ? {} : { body: JSON.stringify(payload) }),
        },
        context,
      );

    const response = await send(first.accessToken);

    if (response.ok || response.status !== 401) {
      return response;
    }

    const fresh = await this.token(context, true);

    if (!fresh.ok) {
      return { ok: false, failure: fresh.failure };
    }

    return send(fresh.accessToken);
  }

  /** ---------- HTTP ---------- */

  private async call(
    path: string,
    init: RequestInit,
    context: ProviderContext,
  ): Promise<PathaoResponse> {
    const baseUrl = context.isSandbox ? SANDBOX_URL : LIVE_URL;

    let response: Response;

    try {
      response = await fetch(`${baseUrl}${path}`, init);
    } catch (error) {
      this.logger.error(
        `Pathao unreachable at ${path}: ${error instanceof Error ? error.message : 'unknown'}`,
      );

      return {
        ok: false,
        failure: unreachable('Pathao'),
      };
    }

    const body: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        failure: translateHttpError(response.status, body, 'Pathao'),
      };
    }

    return { ok: true, body };
  }

  /** ---------- ছোট সহায়ক ---------- */

  /**
   * গ্রাম → কেজি, তাদের সীমার ভেতরে।
   *
   * ন্যূনতমের নিচে **উঠিয়ে দেওয়া হয়** (হালকা পণ্যে তারা নিতই না),
   * কিন্তু সর্বোচ্চের উপরে **`null`** — কম ওজন দেখিয়ে পাঠালে
   * রাইডার তুলতে গিয়ে ফিরে যেত।
   */
  private weightKg(grams: number): number | null {
    const kg = grams / 1000;

    if (kg > MAX_WEIGHT_KG) {
      return null;
    }

    return Math.max(kg, MIN_WEIGHT_KG);
  }

  /**
   * ঠিকানা তাদের সীমার ভেতরে (১০–২২০ অক্ষর)।
   *
   * ছোট হলে শহর-জেলা জুড়ে দেওয়া হয় — এমনিতেও জোড়া উচিত, কারণ
   * তারা ঠিকানা দেখেই জোন বের করে। তাতেও ছোট থাকলে জেলা আবার
   * যোগ করা হয়, কারণ ১০ অক্ষরের কম হলে তারা নেয়ই না।
   */
  private address(request: ParcelRequest): string {
    const parts = [request.recipientAddress, request.recipientCity, request.recipientDistrict]
      .filter((part) => part.trim() !== '')
      .join(', ');

    const padded =
      parts.length >= MIN_ADDRESS_LENGTH ? parts : `${parts}, ${request.recipientDistrict}`;

    return this.clamp(padded, MAX_ADDRESS_LENGTH);
  }

  private clamp(value: string, limit: number): string {
    return value.replace(/\s+/g, ' ').trim().slice(0, limit);
  }

  /** তাদের উত্তর `{ message, type, code, data }` আকারে আসে। */
  private readData(body: unknown): Record<string, unknown> | null {
    if (typeof body !== 'object' || body === null) {
      return null;
    }

    const data = (body as Record<string, unknown>)['data'];

    return typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : null;
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

type PathaoResponse =
  | { ok: true; body: unknown }
  | {
      ok: false;
      /**
       * HTTP status, থাকলে।
       *
       * ঐচ্ছিক কারণ সব ব্যর্থতা HTTP থেকে আসে না — টোকেন নিতে
       * ব্যর্থ হওয়া বা নেটওয়ার্ক ভাঙা দুটোতেই কোনো status নেই।
       * `0` বসিয়ে দিলে `status !== 401` পরীক্ষাটা ঠিকই চলত, কিন্তু
       * "status ০" বলতে কিছু বোঝায় না আর পড়ার সময় ভুল বোঝাত।
       */
      status?: number;
      failure: { ok: false; message: string; retryable: boolean };
    };
