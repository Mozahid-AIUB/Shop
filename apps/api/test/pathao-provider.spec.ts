import { PathaoProvider } from '../src/modules/courier/providers/pathao.provider';
import type { ParcelRequest, ProviderContext } from '../src/modules/courier/courier.provider';

/**
 * Pathao adapter।
 *
 * **Steadfast-এর চেয়ে কঠিন তিন কারণে:**
 *
 * ১. **OAuth** — প্রতিটা কলে key পাঠানো যায় না; আগে টোকেন ইস্যু
 *    করতে হয়, আর সেটার মেয়াদ ৫ দিন।
 * ২. **ওজন কেজিতে, float** — আমাদের দিকে গ্রামে integer, আর
 *    Pathao-র ন্যূনতম ০.৫ সর্বোচ্চ ১০ কেজি।
 * ৩. **store_id বাধ্যতামূলক** — কোন ঠিকানা থেকে পিকআপ হবে।
 *
 * আসল Pathao-তে কল করা হয় না: sandbox-এও টোকেন লাগে, আর CI-তে
 * credential রাখা যায় না। `fetch` বদলে দিয়ে **আমাদের দিকের
 * অনুবাদটা** পরীক্ষা করা হয় — ভুল হওয়ার জায়গা ওটাই।
 */
describe('PathaoProvider', () => {
  let provider: PathaoProvider;

  /** টোকেন কোথায় জমা হলো, সেটা ধরার জন্য। */
  let savedToken: string | null;

  const context = (): ProviderContext => ({
    credentials: {
      clientId: 'test-client',
      clientSecret: 'test-secret',
      username: 'shop@test.local',
      password: 'test-password',
      storeId: '12345',
    },
    isSandbox: true,
    oauthToken: savedToken,
    saveOauthToken: (value: string) => {
      savedToken = value;

      return Promise.resolve();
    },
  });

  const parcel: ParcelRequest = {
    orderNumber: 'ORD-2026-1124-001',
    parcelReference: 'ORD-2026-1124-001',
    recipientName: 'Jahid Hasan',
    recipientPhone: '01712345678',
    recipientAddress: 'House 7, Road 3, Dhanmondi',
    recipientCity: 'Dhaka',
    recipientDistrict: 'Dhaka',
    codAmountPaisa: 106_000,
    itemCount: 2,
    itemDescription: '2 x T-Shirt (L, Black)',
    weightGrams: 800,
    note: null,
  };

  type Call = { url: string; init: RequestInit };

  /**
   * `fetch` বদলে দেওয়া — প্রতিটা কলের জন্য একটা উত্তর, ক্রমে।
   *
   * Pathao-তে প্রায় সবসময় দুটো কল লাগে (টোকেন, তারপর কাজ), তাই
   * তালিকা হিসেবে দেওয়া হয়।
   */
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

  const tokenResponse = (expiresIn = 432_000) => ({
    status: 200,
    body: {
      token_type: 'Bearer',
      expires_in: expiresIn,
      access_token: 'ISSUED_ACCESS_TOKEN',
      refresh_token: 'ISSUED_REFRESH_TOKEN',
    },
  });

  const orderResponse = {
    status: 200,
    body: {
      message: 'Order Created Successfully',
      type: 'success',
      code: 200,
      data: {
        consignment_id: 'DH240101ABCDE',
        merchant_order_id: 'ORD-2026-1124-001',
        order_status: 'Pending',
        delivery_fee: 80,
      },
    },
  };

  const realFetch = globalThis.fetch;

  beforeEach(() => {
    provider = new PathaoProvider();
    savedToken = null;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  describe('getting a token', () => {
    /** ডকে sandbox আর production-এর URL আলাদা। */
    it('uses the sandbox host when the account is in sandbox mode', async () => {
      const { calls } = stubFetch([tokenResponse(), orderResponse]);

      await provider.createParcel(parcel, context());

      expect(calls[0]?.url).toContain('courier-api-sandbox.pathao.com');
    });

    it('uses the live host otherwise', async () => {
      const { calls } = stubFetch([tokenResponse(), orderResponse]);

      await provider.createParcel(parcel, { ...context(), isSandbox: false });

      expect(calls[0]?.url).toContain('api-hermes.pathao.com');
    });

    /** `grant_type: password` — ডকে বাধ্যতামূলক লেখা। */
    it('asks for a token with the password grant', async () => {
      const { calls } = stubFetch([tokenResponse(), orderResponse]);

      await provider.createParcel(parcel, context());

      const body = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>;

      expect(calls[0]?.url).toContain('/aladdin/api/v1/issue-token');
      expect(body['grant_type']).toBe('password');
      expect(body['client_id']).toBe('test-client');
      expect(body['username']).toBe('shop@test.local');
    });

    /**
     * **টোকেন জমা রাখা হয়** — নইলে প্রতিটা পার্সেলে দুটো কল লাগত
     * আর তাদের দিকে অর্থহীন লোড যেত।
     */
    it('saves the token so the next parcel does not ask again', async () => {
      stubFetch([tokenResponse(), orderResponse]);

      await provider.createParcel(parcel, context());

      expect(savedToken).not.toBeNull();
      expect(savedToken).toContain('ISSUED_ACCESS_TOKEN');
    });

    it('reuses a saved token instead of issuing a new one', async () => {
      stubFetch([tokenResponse(), orderResponse]);
      await provider.createParcel(parcel, context());

      // দ্বিতীয় পার্সেল — এবার শুধু অর্ডারের কলটাই হওয়া উচিত
      const { calls } = stubFetch([orderResponse]);

      await provider.createParcel(parcel, context());

      expect(calls).toHaveLength(1);
      expect(calls[0]?.url).toContain('/orders');
    });

    /**
     * **মেয়াদ শেষের আগেই নতুন টোকেন** নেওয়া হয়।
     *
     * ঠিক মেয়াদ শেষের মুহূর্তে নিলে কলটা মাঝপথে অচল হয়ে যেতে
     * পারত — তখন পার্সেল তৈরি হয়নি অথচ কারণটা অস্পষ্ট।
     */
    it('issues a fresh token when the saved one is about to expire', async () => {
      // ৬০ সেকেন্ড বাকি — নিরাপত্তার সীমার ভেতরে
      stubFetch([tokenResponse(60), orderResponse]);
      await provider.createParcel(parcel, context());

      const { calls } = stubFetch([tokenResponse(), orderResponse]);

      await provider.createParcel(parcel, context());

      expect(calls[0]?.url).toContain('/issue-token');
    });

    /** টোকেন নিতে ব্যর্থ হলে key ভুল — retry করে লাভ নেই। */
    it('does not retry when the credentials are rejected', async () => {
      stubFetch([{ status: 401, body: { message: 'Unauthenticated' } }]);

      const result = await provider.createParcel(parcel, context());

      expect(result.ok).toBe(false);

      if (!result.ok) {
        expect(result.retryable).toBe(false);
        expect(result.message).toContain('Pathao');
      }
    });

    /** জমানো টোকেন নষ্ট হলে নতুন নেওয়া হয়, হাল ছাড়া হয় না। */
    it('recovers from a corrupted saved token', async () => {
      savedToken = 'not-json-at-all';

      const { calls } = stubFetch([tokenResponse(), orderResponse]);

      const result = await provider.createParcel(parcel, context());

      expect(calls[0]?.url).toContain('/issue-token');
      expect(result.ok).toBe(true);
    });
  });

  describe('booking a parcel', () => {
    it('sends the token as a Bearer header', async () => {
      const { calls } = stubFetch([tokenResponse(), orderResponse]);

      await provider.createParcel(parcel, context());

      const headers = calls[1]?.init.headers as Record<string, string>;

      expect(headers['Authorization']).toBe('Bearer ISSUED_ACCESS_TOKEN');
    });

    /**
     * **COD টাকায়, paisa-তে নয়** — ডকের উদাহরণে
     * `"amount_to_collect": 900` মানে ৯০০ টাকা।
     */
    it('converts paisa to taka for the collectible amount', async () => {
      const { calls } = stubFetch([tokenResponse(), orderResponse]);

      await provider.createParcel(parcel, context());

      const body = JSON.parse(String(calls[1]?.init.body)) as { amount_to_collect: number };

      expect(body.amount_to_collect).toBe(1060);
    });

    /**
     * **ওজন কেজিতে** — আমাদের দিকে গ্রামে।
     *
     * ৮০০ গ্রাম = ০.৮ কেজি। গ্রাম পাঠালে Pathao ৮০০ কেজি ধরে
     * নিত, সীমা ছাড়িয়ে যেত আর পার্সেল বাতিল হতো।
     */
    it('converts grams to kilograms for the weight', async () => {
      const { calls } = stubFetch([tokenResponse(), orderResponse]);

      await provider.createParcel(parcel, context());

      const body = JSON.parse(String(calls[1]?.init.body)) as { item_weight: string };

      expect(Number(body.item_weight)).toBeCloseTo(0.8, 2);
    });

    /**
     * **ন্যূনতম ০.৫ কেজি** — ডকে লেখা।
     *
     * হালকা পণ্যে (একটা মোজা, একটা চাবির রিং) এর কম হতো, আর
     * Pathao পার্সেলটা নিতই না।
     */
    it('raises a very light parcel to their half-kilo minimum', async () => {
      const { calls } = stubFetch([tokenResponse(), orderResponse]);

      await provider.createParcel({ ...parcel, weightGrams: 50 }, context());

      const body = JSON.parse(String(calls[1]?.init.body)) as { item_weight: string };

      expect(Number(body.item_weight)).toBe(0.5);
    });

    /**
     * **সর্বোচ্চ ১০ কেজি** — এর বেশি হলে পাঠানোই হয় না।
     *
     * ১০-এ নামিয়ে পাঠালে Pathao কম ওজনের বিল করত, কিন্তু রাইডার
     * ২০ কেজির পার্সেল তুলতে গিয়ে ফিরে যেত — আর দোষটা আমাদের
     * দিকেই আসত। স্পষ্ট প্রত্যাখ্যানই সৎ।
     */
    it('refuses a parcel heavier than their limit instead of understating it', async () => {
      stubFetch([tokenResponse(), orderResponse]);

      const result = await provider.createParcel({ ...parcel, weightGrams: 20_000 }, context());

      expect(result.ok).toBe(false);

      if (!result.ok) {
        expect(result.message).toContain('১০');
        expect(result.retryable).toBe(false);
      }
    });

    /** `store_id` থেকে পিকআপের ঠিকানা ঠিক হয় — বাধ্যতামূলক। */
    it('sends the configured store id', async () => {
      const { calls } = stubFetch([tokenResponse(), orderResponse]);

      await provider.createParcel(parcel, context());

      const body = JSON.parse(String(calls[1]?.init.body)) as { store_id: number };

      expect(body.store_id).toBe(12_345);
    });

    /**
     * `delivery_type: 48` (Normal), `item_type: 2` (Parcel)।
     *
     * ডকে সংখ্যাগুলোর মানে লেখা। `12` হলো On Demand — অনেক বেশি
     * দামি, আর ভুল করে পাঠালে প্রতিটা অর্ডারে বেশি খরচ হতো।
     */
    it('books a normal parcel delivery, not on-demand', async () => {
      const { calls } = stubFetch([tokenResponse(), orderResponse]);

      await provider.createParcel(parcel, context());

      const body = JSON.parse(String(calls[1]?.init.body)) as {
        delivery_type: number;
        item_type: number;
      };

      expect(body.delivery_type).toBe(48);
      expect(body.item_type).toBe(2);
    });

    /**
     * **শহর/জোন/এরিয়ার আইডি পাঠানো হয় না**, ইচ্ছাকৃতভাবে।
     *
     * ডকে লেখা: না পাঠালে তারা ঠিকানা দেখে নিজে বের করে নেয়। আমরা
     * জোরে বসালে ভুল জোন দিলে পার্সেল ভুল হাবে চলে যেত — আর তাদের
     * নিজের মেলানো আমাদের অনুমানের চেয়ে ভালো।
     *
     * ডকে সতর্কতাও আছে: "do not send a null value"।
     */
    it('lets Pathao resolve the area from the address', async () => {
      const { calls } = stubFetch([tokenResponse(), orderResponse]);

      await provider.createParcel(parcel, context());

      const body = JSON.parse(String(calls[1]?.init.body)) as Record<string, unknown>;

      expect(body).not.toHaveProperty('recipient_city');
      expect(body).not.toHaveProperty('recipient_zone');
      expect(body).not.toHaveProperty('recipient_area');
    });

    /** পুনঃপ্রেরণে আলাদা reference — তাদের `merchant_order_id`-তে। */
    it('uses the parcel reference as the merchant order id', async () => {
      const { calls } = stubFetch([tokenResponse(), orderResponse]);

      await provider.createParcel(
        { ...parcel, parcelReference: 'ORD-2026-1124-001-R2' },
        context(),
      );

      const body = JSON.parse(String(calls[1]?.init.body)) as { merchant_order_id: string };

      expect(body.merchant_order_id).toBe('ORD-2026-1124-001-R2');
    });

    /** ঠিকানার সীমা ১০–২২০ অক্ষর — ছোট হলে তারা নেয় না। */
    it('pads a very short address to their minimum length', async () => {
      const { calls } = stubFetch([tokenResponse(), orderResponse]);

      await provider.createParcel({ ...parcel, recipientAddress: 'Bazar' }, context());

      const body = JSON.parse(String(calls[1]?.init.body)) as { recipient_address: string };

      expect(body.recipient_address.length).toBeGreaterThanOrEqual(10);
    });

    it('returns the consignment id and the delivery fee', async () => {
      stubFetch([tokenResponse(), orderResponse]);

      const result = await provider.createParcel(parcel, context());

      expect(result.ok).toBe(true);

      if (result.ok) {
        expect(result.consignmentId).toBe('DH240101ABCDE');
        // ৮০ টাকা → paisa, কারণ আমাদের সব হিসাব paisa-তে
        expect(result.feePaisa).toBe(8_000);
      }
    });

    /**
     * টোকেন মাঝপথে অচল হলে **একবার** নতুন নিয়ে আবার চেষ্টা।
     *
     * না করলে অ্যাডমিন অকারণে ব্যর্থতা দেখত, অথচ শুধু টোকেনটা
     * পুরোনো ছিল। একবারই — নইলে key সত্যিই ভুল হলে অসীম লুপ হতো।
     */
    it('retries once with a fresh token when the saved one is rejected', async () => {
      stubFetch([tokenResponse(), orderResponse]);
      await provider.createParcel(parcel, context());

      const { calls } = stubFetch([
        { status: 401, body: { message: 'Unauthenticated' } },
        tokenResponse(),
        orderResponse,
      ]);

      const result = await provider.createParcel(parcel, context());

      expect(result.ok).toBe(true);
      expect(calls[1]?.url).toContain('/issue-token');
    });

    /** ৪২২ — কোন মাঠ, সেটা অ্যাডমিনকে বলা হয়। */
    it('names the field Pathao rejected', async () => {
      stubFetch([
        tokenResponse(),
        {
          status: 422,
          body: {
            message: 'Validation error',
            errors: { recipient_phone: ['The recipient phone must be 11 characters.'] },
          },
        },
      ]);

      const result = await provider.createParcel(parcel, context());

      expect(result.ok).toBe(false);

      if (!result.ok) {
        expect(result.message).toContain('recipient_phone');
      }
    });

    it('marks their server error as worth retrying', async () => {
      stubFetch([tokenResponse(), { status: 500, body: { message: 'Server Error' } }]);

      const result = await provider.createParcel(parcel, context());

      if (!result.ok) {
        expect(result.retryable).toBe(true);
      }
    });

    it('handles a response shape it does not recognise', async () => {
      stubFetch([tokenResponse(), { status: 200, body: { unexpected: true } }]);

      const result = await provider.createParcel(parcel, context());

      expect(result.ok).toBe(false);
    });
  });

  describe('reading a parcel status', () => {
    const info = (slug: string) => ({
      status: 200,
      body: {
        message: 'Order info',
        type: 'success',
        code: 200,
        data: {
          consignment_id: 'DH240101ABCDE',
          order_status: slug,
          order_status_slug: slug,
          updated_at: '2026-11-24 15:11:40',
        },
      },
    });

    it('maps a delivered parcel', async () => {
      stubFetch([tokenResponse(), info('Delivered')]);

      const result = await provider.track('DH240101ABCDE', context());

      expect(result.ok).toBe(true);

      if (result.ok) {
        expect(result.status).toBe('DELIVERED');
      }
    });

    it('keeps a pending parcel pending', async () => {
      stubFetch([tokenResponse(), info('Pending')]);

      const result = await provider.track('DH240101ABCDE', context());

      if (result.ok) {
        expect(result.status).toBe('PENDING');
      }
    });

    /**
     * **ফেরত আসা পার্সেল `RETURNED`, `CANCELLED` নয়।**
     *
     * আমাদের `CANCELLED` মানে পাঠানোই হয়নি। মিলিয়ে ফেললে ফেরত
     * আসা পণ্য কেউ জানত না আর স্টকেও যোগ হতো না।
     */
    it('maps a returned parcel to RETURNED', async () => {
      stubFetch([tokenResponse(), info('Return')]);

      const result = await provider.track('DH240101ABCDE', context());

      if (result.ok) {
        expect(result.status).toBe('RETURNED');
      }
    });

    /** অজানা অবস্থা — অনুমান করা হয় না। */
    it('does not guess at a status it does not know', async () => {
      stubFetch([tokenResponse(), info('Teleported')]);

      const result = await provider.track('DH240101ABCDE', context());

      expect(result.ok).toBe(false);

      if (!result.ok) {
        expect(result.message).toContain('Teleported');
      }
    });
  });

  describe('the webhook', () => {
    const body = {
      consignment_id: 'DH240101ABCDE',
      merchant_order_id: 'ORD-1',
      order_status: 'Delivered',
      updated_at: '2026-11-24 15:11:40',
    };

    const secret = 'pathao-webhook-secret';

    /**
     * Pathao-র webhook-এ HMAC signature নেই — তারা একটা
     * শেয়ার করা key পাঠায় header-এ।
     *
     * তুলনা **সময়-নিরপেক্ষ** (`webhook-guard`), নইলে উত্তরের সময়
     * মেপে অক্ষর ধরে ধরে key অনুমান করা যেত।
     */
    it('accepts a webhook carrying the configured key', () => {
      const update = provider.parseWebhook(body, { 'x-pathao-signature': secret }, secret);

      expect(update).not.toBeNull();
      expect(update?.consignmentId).toBe('DH240101ABCDE');
      expect(update?.status).toBe('DELIVERED');
    });

    it('refuses everything when no secret is configured', () => {
      expect(provider.parseWebhook(body, { 'x-pathao-signature': secret }, null)).toBeNull();
    });

    it('refuses a wrong key', () => {
      expect(provider.parseWebhook(body, { 'x-pathao-signature': 'wrong' }, secret)).toBeNull();
    });

    it('refuses a missing key', () => {
      expect(provider.parseWebhook(body, {}, secret)).toBeNull();
    });

    it('ignores a status it does not know', () => {
      const odd = { ...body, order_status: 'Teleported' };

      expect(provider.parseWebhook(odd, { 'x-pathao-signature': secret }, secret)).toBeNull();
    });

    it('ignores a body that is not shaped like a webhook', () => {
      expect(provider.parseWebhook(null, { 'x-pathao-signature': secret }, secret)).toBeNull();
      expect(provider.parseWebhook('text', { 'x-pathao-signature': secret }, secret)).toBeNull();
    });
  });
});
