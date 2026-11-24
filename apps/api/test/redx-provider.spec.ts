import { RedxProvider } from '../src/modules/courier/providers/redx.provider';
import type { ParcelRequest, ProviderContext } from '../src/modules/courier/courier.provider';

/**
 * RedX adapter।
 *
 * **অন্য দুটোর চেয়ে আলাদা দুই জায়গায়:**
 *
 * ১. **`delivery_area_id` বাধ্যতামূলক** — আমাদের ঠিকানায় শুধু
 *    জেলার নাম আছে, তাদের আইডি নেই। `/areas` থেকে মেলাতে হয়।
 *
 * ২. **webhook-এ signature নেই** — ডকে লেখা, credential
 *    **query parameter**-এ আসে (`?token=xxx`), header-এ নয়।
 */
describe('RedxProvider', () => {
  let provider: RedxProvider;

  const context = (): ProviderContext => ({
    credentials: { accessToken: 'test-jwt-token', pickupStoreId: '77' },
    isSandbox: true,
  });

  const parcel: ParcelRequest = {
    orderNumber: 'ORD-2026-1124-001',
    parcelReference: 'ORD-2026-1124-001',
    recipientName: 'Jahid Hasan',
    recipientPhone: '01712345678',
    recipientAddress: 'House 7, Road 3',
    recipientCity: 'Dhaka',
    recipientDistrict: 'Dhaka',
    codAmountPaisa: 106_000,
    itemCount: 2,
    itemDescription: '2 x T-Shirt (L, Black)',
    weightGrams: 800,
    note: null,
  };

  type Call = { url: string; init: RequestInit };

  const stubFetch = (responses: { status: number; body: unknown }[]): { calls: Call[] } => {
    const calls: Call[] = [];
    let index = 0;

    globalThis.fetch = ((url: string, init: RequestInit) => {
      calls.push({ url, init });

      const response = responses[Math.min(index, responses.length - 1)];

      index += 1;

      return Promise.resolve({
        ok: (response?.status ?? 500) >= 200 && (response?.status ?? 500) < 300,
        status: response?.status ?? 500,
        json: () => Promise.resolve(response?.body ?? null),
      } as Response);
    }) as typeof fetch;

    return { calls };
  };

  const areasResponse = {
    status: 200,
    body: {
      areas: [
        { id: 1, name: 'Mohammadpur(Dhaka)', post_code: 1207, division_name: 'Dhaka', zone_id: 1 },
        { id: 2, name: 'Dhanmondi', post_code: 1209, division_name: 'Dhaka', zone_id: 1 },
      ],
    },
  };

  const parcelResponse = { status: 200, body: { tracking_id: '20A312THJDJ8' } };

  const realFetch = globalThis.fetch;

  beforeEach(() => {
    provider = new RedxProvider();
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  describe('finding the delivery area', () => {
    /**
     * **জেলার নাম থেকে তাদের আইডি** — `delivery_area_id` ছাড়া
     * পার্সেল তৈরি হয় না।
     */
    it('looks the area up by district name', async () => {
      const { calls } = stubFetch([areasResponse, parcelResponse]);

      await provider.createParcel(parcel, context());

      expect(calls[0]?.url).toContain('/areas?district_name=Dhaka');
    });

    /**
     * **তালিকাটা ক্যাশ হয়** — এরিয়া প্রায় বদলায় না, আর প্রতি
     * পার্সেলে আনলে বাড়তি কল যেত।
     */
    it('does not look the same district up twice', async () => {
      stubFetch([areasResponse, parcelResponse]);
      await provider.createParcel(parcel, context());

      const { calls } = stubFetch([parcelResponse]);

      await provider.createParcel(parcel, context());

      expect(calls).toHaveLength(1);
      expect(calls[0]?.url).toContain('/parcel');
    });

    /**
     * এরিয়া না মিললে **স্পষ্ট বার্তা**, অনুমান নয়।
     *
     * যেকোনো একটা আইডি বসিয়ে দিলে পার্সেল ভুল এলাকায় চলে যেত, আর
     * ক্রেতা পণ্য পেত না — অথচ আমাদের দিকে সব ঠিক দেখাত।
     */
    it('refuses rather than guessing when the district is unknown', async () => {
      stubFetch([{ status: 200, body: { areas: [] } }]);

      const result = await provider.createParcel(
        { ...parcel, recipientDistrict: 'Nowhere' },
        context(),
      );

      expect(result.ok).toBe(false);

      if (!result.ok) {
        expect(result.message).toContain('Nowhere');
        expect(result.retryable).toBe(false);
      }
    });

    /** এরিয়ার তালিকা আনতে ব্যর্থ হলে retry করা যায়। */
    it('marks an area lookup failure as retryable', async () => {
      stubFetch([{ status: 500, body: null }]);

      const result = await provider.createParcel(parcel, context());

      expect(result.ok).toBe(false);

      if (!result.ok) {
        expect(result.retryable).toBe(true);
      }
    });
  });

  describe('booking a parcel', () => {
    /** ডকে লেখা আকার: `API-ACCESS-TOKEN: Bearer <jwt>`। */
    it('sends the token in their own header, not Authorization', async () => {
      const { calls } = stubFetch([areasResponse, parcelResponse]);

      await provider.createParcel(parcel, context());

      const headers = calls[1]?.init.headers as Record<string, string>;

      expect(headers['API-ACCESS-TOKEN']).toBe('Bearer test-jwt-token');
      expect(headers['Authorization']).toBeUndefined();
    });

    it('uses the sandbox host in sandbox mode', async () => {
      const { calls } = stubFetch([areasResponse, parcelResponse]);

      await provider.createParcel(parcel, context());

      expect(calls[0]?.url).toContain('sandbox.redx.com.bd');
    });

    it('uses the live host otherwise', async () => {
      const { calls } = stubFetch([areasResponse, parcelResponse]);

      await provider.createParcel(parcel, { ...context(), isSandbox: false });

      expect(calls[0]?.url).toContain('openapi.redx.com.bd');
    });

    /**
     * **ওজন গ্রামে** — ডকে লেখা "Weight of the parcel in grams"।
     *
     * আমাদের দিকেও গ্রামে, তাই এখানে ভাগ করার কিছু নেই। Pathao-র
     * উল্টো, আর সেজন্যই গ্রামে সংরক্ষণ করা হয়।
     */
    it('sends the weight in grams, unchanged', async () => {
      const { calls } = stubFetch([areasResponse, parcelResponse]);

      await provider.createParcel(parcel, context());

      const body = JSON.parse(String(calls[1]?.init.body)) as { parcel_weight: string };

      expect(Number(body.parcel_weight)).toBe(800);
    });

    /** COD টাকায় — ডকের উদাহরণে `cash_collection_amount: 13293`। */
    it('converts paisa to taka for the collection amount', async () => {
      const { calls } = stubFetch([areasResponse, parcelResponse]);

      await provider.createParcel(parcel, context());

      const body = JSON.parse(String(calls[1]?.init.body)) as {
        cash_collection_amount: string;
      };

      expect(Number(body.cash_collection_amount)).toBe(1060);
    });

    /** পুনঃপ্রেরণে আলাদা reference — তাদের `merchant_invoice_id`-তে। */
    it('uses the parcel reference as the merchant invoice id', async () => {
      const { calls } = stubFetch([areasResponse, parcelResponse]);

      await provider.createParcel(
        { ...parcel, parcelReference: 'ORD-2026-1124-001-R2' },
        context(),
      );

      const body = JSON.parse(String(calls[1]?.init.body)) as { merchant_invoice_id: string };

      expect(body.merchant_invoice_id).toBe('ORD-2026-1124-001-R2');
    });

    /**
     * **খুলে দেখতে দেওয়া — অ্যাডমিনের সিদ্ধান্ত, হার্ডকোড নয়।**
     *
     * পণ্যভেদে ঠিক উত্তর আলাদা:
     *
     * - মোবাইল/ইলেকট্রনিক্সে **দরকার** — না দেখে কেউ ১৫ হাজার
     *   টাকা দেয় না
     * - কাস্টম ছাপা পণ্যে **ক্ষতিকর** — "ডিজাইন পছন্দ হয়নি" বলে
     *   ফেরত দিলে সেটা আর কাউকে বেচা যায় না
     * - খাবার/প্রসাধনীতে ক্ষতিকর — সিল ভাঙলে আর বিক্রি হয় না
     *
     * এই কোড অন্য ব্যবসায়ীদের কাছেও যাবে, আর তাদের পণ্য আলাদা।
     * তাই সিদ্ধান্তটা সেটআপে।
     *
     * ডিফল্ট **খুলে দেখতে দেওয়া**: বেশিরভাগ দোকানে সেটাই ঠিক, আর
     * নতুন দোকানে ক্রেতার বিশ্বাসই সবচেয়ে বড় বাধা।
     */
    it('lets the customer inspect the parcel by default', async () => {
      const { calls } = stubFetch([areasResponse, parcelResponse]);

      await provider.createParcel(parcel, context());

      const body = JSON.parse(String(calls[1]?.init.body)) as { is_closed_box: boolean };

      expect(body.is_closed_box).toBe(false);
    });

    /** অ্যাডমিন বন্ধ করলে সিল করা পার্সেল যায় — কাস্টম বা সিল করা পণ্যে দরকার। */
    it('sends a closed box when the admin turns inspection off', async () => {
      const { calls } = stubFetch([areasResponse, parcelResponse]);

      await provider.createParcel(parcel, { ...context(), allowOpenBox: false });

      const body = JSON.parse(String(calls[1]?.init.body)) as { is_closed_box: boolean };

      expect(body.is_closed_box).toBe(true);
    });

    /**
     * **`value` পণ্যের দাম, COD-র অঙ্ক নয়।**
     *
     * ডকে লেখা "Declared value of the parcel for compensation
     * calculation" — পার্সেল হারালে এই অঙ্কে ক্ষতিপূরণ হয়। COD ০
     * হলেও (আগে পেমেন্ট) পণ্যের দাম ০ নয়, নইলে হারালে কিছুই
     * পাওয়া যেত না।
     */
    it('declares the goods value even when nothing is collected', async () => {
      const { calls } = stubFetch([areasResponse, parcelResponse]);

      await provider.createParcel({ ...parcel, codAmountPaisa: 0 }, context());

      const body = JSON.parse(String(calls[1]?.init.body)) as {
        cash_collection_amount: string;
        value: string;
      };

      expect(Number(body.cash_collection_amount)).toBe(0);
      expect(Number(body.value)).toBeGreaterThan(0);
    });

    it('sends the configured pickup store', async () => {
      const { calls } = stubFetch([areasResponse, parcelResponse]);

      await provider.createParcel(parcel, context());

      const body = JSON.parse(String(calls[1]?.init.body)) as { pickup_store_id: number };

      expect(body.pickup_store_id).toBe(77);
    });

    it('returns the tracking id as the consignment id', async () => {
      stubFetch([areasResponse, parcelResponse]);

      const result = await provider.createParcel(parcel, context());

      expect(result.ok).toBe(true);

      if (result.ok) {
        expect(result.consignmentId).toBe('20A312THJDJ8');
        expect(result.trackingCode).toBe('20A312THJDJ8');
      }
    });

    it('names the field RedX rejected', async () => {
      stubFetch([
        areasResponse,
        { status: 422, body: { errors: { customer_phone: ['invalid phone'] } } },
      ]);

      const result = await provider.createParcel(parcel, context());

      if (!result.ok) {
        expect(result.message).toContain('customer_phone');
      }
    });

    it('does not retry a rejected token', async () => {
      stubFetch([areasResponse, { status: 401, body: { message: 'Unauthorized' } }]);

      const result = await provider.createParcel(parcel, context());

      if (!result.ok) {
        expect(result.retryable).toBe(false);
        expect(result.message).toContain('RedX');
      }
    });
  });

  describe('reading a parcel status', () => {
    const info = (status: string) => ({
      status: 200,
      body: {
        parcel: {
          tracking_id: '20A312THJDJ8',
          status,
          customer_name: 'Jahid Hasan',
          cash_collection_amount: 1060,
        },
      },
    });

    it('maps a delivered parcel', async () => {
      stubFetch([info('delivered')]);

      const result = await provider.track('20A312THJDJ8', context());

      if (result.ok) {
        expect(result.status).toBe('DELIVERED');
      }
    });

    it('keeps a parcel pending before pickup', async () => {
      stubFetch([info('pickup-pending')]);

      const result = await provider.track('20A312THJDJ8', context());

      if (result.ok) {
        expect(result.status).toBe('PENDING');
      }
    });

    it('maps a dispatched parcel to in transit', async () => {
      stubFetch([info('delivery-in-progress')]);

      const result = await provider.track('20A312THJDJ8', context());

      if (result.ok) {
        expect(result.status).toBe('IN_TRANSIT');
      }
    });

    it('maps a returned parcel to RETURNED', async () => {
      stubFetch([info('returned')]);

      const result = await provider.track('20A312THJDJ8', context());

      if (result.ok) {
        expect(result.status).toBe('RETURNED');
      }
    });

    /**
     * `agent-hold` — ডকে "Parcels are on hold to agent"।
     *
     * কোনো স্বাভাবিক অবস্থায় map করা হয় না: করলে অ্যাডমিন ভাবত
     * পার্সেল চলছে, অথচ সেটা আটকে আছে আর কারো নজর দরকার।
     */
    it('does not map a held parcel to a normal status', async () => {
      stubFetch([info('agent-hold')]);

      const result = await provider.track('20A312THJDJ8', context());

      expect(result.ok).toBe(false);

      if (!result.ok) {
        expect(result.message).toContain('agent-hold');
      }
    });

    it('does not guess at a status it does not know', async () => {
      stubFetch([info('teleported')]);

      const result = await provider.track('20A312THJDJ8', context());

      expect(result.ok).toBe(false);
    });
  });

  describe('cancelling a parcel', () => {
    /**
     * **RedX-এ বাতিল করা যায়** — একমাত্র কুরিয়ার যার API-তে এটা আছে।
     *
     * ডকের `PATCH /parcels` দিয়ে `status` → `cancelled`।
     */
    it('cancels through their update endpoint', async () => {
      const { calls } = stubFetch([
        { status: 200, body: { success: true, message: 'Request Accepted' } },
      ]);

      const result = await provider.cancel('20A312THJDJ8', context());

      expect(result.ok).toBe(true);
      expect(calls[0]?.init.method).toBe('PATCH');

      const body = JSON.parse(String(calls[0]?.init.body)) as {
        entity_type: string;
        entity_id: string;
        update_details: { property_name: string; new_value: string };
      };

      expect(body.entity_type).toBe('parcel-tracking-id');
      expect(body.entity_id).toBe('20A312THJDJ8');
      expect(body.update_details.new_value).toBe('cancelled');
    });

    /**
     * `success: false` এলে **ব্যর্থ** — ২০০ হলেও।
     *
     * শুধু HTTP কোড দেখলে অ্যাডমিন ভাবত পার্সেল আটকানো গেছে, অথচ
     * সেটা ক্রেতার কাছে চলেই যেত।
     */
    it('treats a refusal inside a 200 as a failure', async () => {
      stubFetch([{ status: 200, body: { success: false, message: 'Already dispatched' } }]);

      const result = await provider.cancel('20A312THJDJ8', context());

      expect(result.ok).toBe(false);
    });
  });

  describe('the webhook', () => {
    const body = {
      tracking_number: '20A312THJDJ8',
      timestamp: '2026-11-24T10:00:00.000Z',
      status: 'delivered',
      message_en: 'Parcel delivered',
      message_bn: 'পার্সেল পৌঁছে গেছে',
      invoice_number: 'ORD-1',
      delivery_type: 'regular',
    };

    const secret = 'redx-webhook-token';

    /**
     * **RedX-এ signature নেই** — ডকে লেখা, credential
     * **query parameter**-এ আসে: `https://example.com/callback?token=xxx`।
     *
     * তাই header নয়, query থেকে পড়া হয়। তুলনা সময়-নিরপেক্ষ, নইলে
     * উত্তরের সময় মেপে অক্ষর ধরে ধরে token অনুমান করা যেত।
     */
    it('accepts a webhook whose query carries the configured token', () => {
      const update = provider.parseWebhook(body, { 'x-query-token': secret }, secret);

      expect(update).not.toBeNull();
      expect(update?.consignmentId).toBe('20A312THJDJ8');
      expect(update?.status).toBe('DELIVERED');
    });

    it('refuses everything when no secret is configured', () => {
      expect(provider.parseWebhook(body, { 'x-query-token': secret }, null)).toBeNull();
    });

    it('refuses a wrong token', () => {
      expect(provider.parseWebhook(body, { 'x-query-token': 'wrong' }, secret)).toBeNull();
    });

    it('refuses a missing token', () => {
      expect(provider.parseWebhook(body, {}, secret)).toBeNull();
    });

    /** `ready-for-delivery` = কুরিয়ার পণ্য নিয়েছে। */
    it('maps their pickup status', () => {
      const picked = { ...body, status: 'ready-for-delivery' };
      const update = provider.parseWebhook(picked, { 'x-query-token': secret }, secret);

      expect(update?.status).toBe('PICKED_UP');
    });

    /**
     * `paid` অবস্থা **উপেক্ষা করা হয়**।
     *
     * ডকে লেখা "Parcel amount is paid" — ওটা কুরিয়ারের টাকা
     * পরিশোধের ঘটনা, পার্সেলের গতি নয়। পার্সেলের অবস্থায় বসালে
     * `DELIVERED`-কে ছাপিয়ে যেত আর ইতিহাস বিভ্রান্তিকর হতো।
     */
    it('ignores a payout notification', () => {
      const paid = { ...body, status: 'paid' };

      expect(provider.parseWebhook(paid, { 'x-query-token': secret }, secret)).toBeNull();
    });

    /** বাংলা বার্তাটা রাখা হয় — অ্যাডমিন সেটাই পড়ে। */
    it('keeps the Bengali message as the note', () => {
      const update = provider.parseWebhook(body, { 'x-query-token': secret }, secret);

      expect(update?.note).toBe('পার্সেল পৌঁছে গেছে');
    });

    it('ignores a status it does not know', () => {
      const odd = { ...body, status: 'teleported' };

      expect(provider.parseWebhook(odd, { 'x-query-token': secret }, secret)).toBeNull();
    });

    it('ignores a body that is not shaped like a webhook', () => {
      expect(provider.parseWebhook(null, { 'x-query-token': secret }, secret)).toBeNull();
    });
  });
});
