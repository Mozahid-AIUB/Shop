import { createHmac } from 'node:crypto';
import { SteadfastProvider } from '../src/modules/courier/providers/steadfast.provider';
import type { ParcelRequest, ProviderContext } from '../src/modules/courier/courier.provider';

/**
 * Steadfast adapter।
 *
 * **কেন ইউনিট টেস্ট, e2e নয়:** আসল Steadfast-এ কল করলে সত্যিকারের
 * পার্সেল বুক হয়ে যেত — ডকেই লেখা "Each books a real parcel"। আর
 * CI-তে তাদের key রাখা যায় না।
 *
 * তাই `fetch` বদলে দিয়ে **আমাদের দিকের অনুবাদটা** পরীক্ষা করা হয়:
 * কী পাঠাচ্ছি, তাদের উত্তর কীভাবে পড়ছি, আর ভুল হলে কী বলছি।
 * এটাই আসলে ভুল হওয়ার জায়গা — তাদের সার্ভার আমাদের টেস্টের বিষয় নয়।
 */
describe('SteadfastProvider', () => {
  const provider = new SteadfastProvider();

  const context: ProviderContext = {
    credentials: { apiKey: 'test-api-key', secretKey: 'test-secret-key' },
    isSandbox: false,
  };

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
    note: null,
  };

  /** `fetch` বদলে দিয়ে কী পাঠানো হলো সেটা ধরা। */
  const stubFetch = (
    status: number,
    body: unknown,
  ): { calls: { url: string; init: RequestInit }[] } => {
    const calls: { url: string; init: RequestInit }[] = [];

    globalThis.fetch = ((url: string, init: RequestInit) => {
      calls.push({ url, init });

      return Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(body),
        text: () => Promise.resolve(JSON.stringify(body)),
      } as Response);
    }) as typeof fetch;

    return { calls };
  };

  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  describe('booking a parcel', () => {
    it('sends the keys as headers, not in the body', async () => {
      const { calls } = stubFetch(200, {
        status: 200,
        consignment: { consignment_id: 1234, tracking_code: 'TRK123', status: 'in_review' },
      });

      await provider.createParcel(parcel, context);

      const headers = calls[0]?.init.headers as Record<string, string>;

      expect(headers['Api-Key']).toBe('test-api-key');
      expect(headers['Secret-Key']).toBe('test-secret-key');
      expect(headers['Content-Type']).toBe('application/json');

      // key body-তে গেলে তাদের log-এ জমা হতো, আর ডকে ওভাবে চায়ও না
      expect(calls[0]?.init.body).not.toContain('test-secret-key');
    });

    /**
     * **COD টাকায় পাঠাতে হয়, paisa-তে নয়।**
     *
     * ডকের উদাহরণে `"cod_amount":1060` মানে ১০৬০ টাকা। paisa পাঠালে
     * কুরিয়ার ১০৬০০০ টাকা তুলতে যেত — ক্রেতার কাছে ১০০ গুণ বেশি।
     * এটাই এই adapter-এর সবচেয়ে ব্যয়বহুল সম্ভাব্য ভুল।
     */
    it('converts paisa to taka for the COD amount', async () => {
      const { calls } = stubFetch(200, {
        status: 200,
        consignment: { consignment_id: 1, tracking_code: 'T', status: 'in_review' },
      });

      await provider.createParcel(parcel, context);

      const body = JSON.parse(String(calls[0]?.init.body)) as { cod_amount: number };

      expect(body.cod_amount).toBe(1060);
    });

    /**
     * ভাঙা পয়সা **উপরের দিকে** নেওয়া হয়।
     *
     * নিচে নিলে দোকান প্রতি অর্ডারে এক টাকা পর্যন্ত কম পেত, আর সেটা
     * কুরিয়ারের কাছ থেকে আর আদায় করা যেত না। উপরে নিলে ক্রেতা
     * সর্বোচ্চ এক টাকা বেশি দেয় — যা বাংলাদেশে এমনিতেও হয় (খুচরা)।
     */
    it('rounds a part-taka COD up, not down', async () => {
      const { calls } = stubFetch(200, {
        status: 200,
        consignment: { consignment_id: 1, tracking_code: 'T', status: 'in_review' },
      });

      await provider.createParcel({ ...parcel, codAmountPaisa: 106_050 }, context);

      const body = JSON.parse(String(calls[0]?.init.body)) as { cod_amount: number };

      expect(body.cod_amount).toBe(1061);
    });

    /** পেমেন্ট হয়ে গেলে ০ — কুরিয়ার আবার টাকা চাইলে ক্রেতা দুবার দিত। */
    it('sends zero when the order is already paid', async () => {
      const { calls } = stubFetch(200, {
        status: 200,
        consignment: { consignment_id: 1, tracking_code: 'T', status: 'in_review' },
      });

      await provider.createParcel({ ...parcel, codAmountPaisa: 0 }, context);

      const body = JSON.parse(String(calls[0]?.init.body)) as { cod_amount: number };

      expect(body.cod_amount).toBe(0);
    });

    /**
     * **`invoice`-এ `parcelReference` যায়, `orderNumber` নয়।**
     *
     * Steadfast একই `invoice` দুবার নেয় না। ফেরত আসা পার্সেল আবার
     * পাঠাতে গেলে অর্ডার নম্বর একই থাকে, তাই তারা না বলত — আর
     * দোকান পণ্যটা আর পাঠাতেই পারত না।
     */
    it('uses the parcel reference as the invoice, so a resend is accepted', async () => {
      const { calls } = stubFetch(200, {
        status: 200,
        consignment: { consignment_id: 1, tracking_code: 'T', status: 'in_review' },
      });

      await provider.createParcel(
        { ...parcel, parcelReference: 'ORD-2026-1124-001-R2' },
        context,
      );

      const body = JSON.parse(String(calls[0]?.init.body)) as { invoice: string };

      expect(body.invoice).toBe('ORD-2026-1124-001-R2');
    });

    /**
     * ঠিকানায় শহর আর জেলা **জুড়ে দেওয়া হয়**।
     *
     * Steadfast-এ আলাদা city/district মাঠ নেই, একটাই
     * `recipient_address`। না জুড়লে রাইডার শুধু "House 7, Road 3"
     * দেখত আর কোন শহরে যাবে বুঝত না।
     */
    it('folds city and district into the single address field', async () => {
      const { calls } = stubFetch(200, {
        status: 200,
        consignment: { consignment_id: 1, tracking_code: 'T', status: 'in_review' },
      });

      await provider.createParcel(parcel, context);

      const body = JSON.parse(String(calls[0]?.init.body)) as { recipient_address: string };

      expect(body.recipient_address).toContain('House 7, Road 3, Dhanmondi');
      expect(body.recipient_address).toContain('Dhaka');
    });

    /**
     * **Steadfast কিছু অক্ষর মুছে দেয়** — ডকে লেখা: `{ } ; < > $`
     * প্রতিটা ফাঁকা জায়গায় বদলে যায়।
     *
     * তাই আমরা **আগেই** সরিয়ে পাঠাই। না সরালে ঠিকানা তাদের দিকে
     * বদলে যেত আর আমাদের রেকর্ডের সাথে মিলত না — অভিযোগের সময়
     * কোনটা আসল তা বলা যেত না।
     */
    it('strips the characters Steadfast would silently replace', async () => {
      const { calls } = stubFetch(200, {
        status: 200,
        consignment: { consignment_id: 1, tracking_code: 'T', status: 'in_review' },
      });

      await provider.createParcel(
        { ...parcel, recipientAddress: 'House <7>; Road {3} $cash' },
        context,
      );

      const body = JSON.parse(String(calls[0]?.init.body)) as { recipient_address: string };

      for (const char of ['<', '>', ';', '{', '}', '$']) {
        expect(body.recipient_address).not.toContain(char);
      }
    });

    /**
     * **লম্বা মান আগেই ছোট করা হয়** — Steadfast নইলে নিজে কেটে দেয়।
     *
     * ডকের সীমা: invoice ১০০, নাম ১০০, ফোন ৪০, ঠিকানা ৪৯০, নোট ৪৮০।
     * তারা কেটে দিলে আমাদের রেকর্ডে পুরোটা থাকত আর তাদের দিকে
     * অর্ধেক — ঠিকানা অর্ধেক হলে পার্সেল পৌঁছাত না।
     */
    it('truncates long values itself instead of letting Steadfast cut them', async () => {
      const { calls } = stubFetch(200, {
        status: 200,
        consignment: { consignment_id: 1, tracking_code: 'T', status: 'in_review' },
      });

      await provider.createParcel(
        { ...parcel, recipientName: 'অ'.repeat(200), note: 'n'.repeat(600) },
        context,
      );

      const body = JSON.parse(String(calls[0]?.init.body)) as {
        recipient_name: string;
        note: string;
      };

      expect(body.recipient_name.length).toBeLessThanOrEqual(100);
      expect(body.note.length).toBeLessThanOrEqual(480);
    });

    it('returns the consignment id and tracking code', async () => {
      stubFetch(200, {
        status: 200,
        consignment: { consignment_id: 9876, tracking_code: 'TRK-ABC', status: 'in_review' },
      });

      const result = await provider.createParcel(parcel, context);

      expect(result.ok).toBe(true);

      if (result.ok) {
        // id সংখ্যা হিসেবে আসে, আমরা string-এ রাখি — DB-র কলাম TEXT
        expect(result.consignmentId).toBe('9876');
        expect(result.trackingCode).toBe('TRK-ABC');
      }
    });
  });

  describe('when Steadfast says no', () => {
    /**
     * ৪০১ = key ভুল। **`retryable: false`**, কারণ আবার চেষ্টা করলে
     * একই উত্তর আসবে — আর ডকে লেখা, বারবার ৪০১ পেলে ৬০ মিনিটের
     * জন্য পুরো অ্যাকাউন্ট আটকে যায়। লুপে retry করলে ঠিক key
     * বসানোর পরেও দোকান এক ঘণ্টা পার্সেল পাঠাতে পারত না।
     */
    it('does not retry a wrong key', async () => {
      stubFetch(401, { message: 'Unauthenticated' });

      const result = await provider.createParcel(parcel, context);

      expect(result.ok).toBe(false);

      if (!result.ok) {
        expect(result.retryable).toBe(false);
        expect(result.message).toContain('key');
      }
    });

    /** ৪২২ = মাঠ ভুল। অ্যাডমিনকে **কোন মাঠ** সেটা বলা হয়। */
    it('names the field Steadfast rejected', async () => {
      stubFetch(422, {
        message: 'validation error',
        errors: { recipient_phone: ['The recipient phone must be 11 digits.'] },
      });

      const result = await provider.createParcel(parcel, context);

      expect(result.ok).toBe(false);

      if (!result.ok) {
        expect(result.message).toContain('recipient_phone');
        expect(result.retryable).toBe(false);
      }
    });

    /**
     * ৪২৯ = অনেক বেশি request। **`retryable: true`** — অপেক্ষা করলে
     * কাজ হবে।
     */
    it('marks a rate limit as worth retrying', async () => {
      stubFetch(429, { message: 'Too many requests' });

      const result = await provider.createParcel(parcel, context);

      expect(result.ok).toBe(false);

      if (!result.ok) {
        expect(result.retryable).toBe(true);
      }
    });

    /**
     * ৫০০ = তাদের দোষ। ডকে লেখা: "Retry with the same invoice;
     * duplicate invoices are refused, so a retry cannot double-book."
     *
     * তাই `retryable: true` — দুবার বুক হওয়ার ভয় নেই।
     */
    it('marks their server error as worth retrying', async () => {
      stubFetch(500, { message: 'Server Error' });

      const result = await provider.createParcel(parcel, context);

      expect(result.ok).toBe(false);

      if (!result.ok) {
        expect(result.retryable).toBe(true);
      }
    });

    /**
     * **২০০-র ভেতরেও ব্যর্থতা থাকতে পারে** — ডকে স্পষ্ট লেখা:
     * "Some endpoints report a per-item failure inside a 200 — always
     * read the body."
     *
     * শুধু HTTP কোড দেখলে পার্সেল তৈরি হয়নি অথচ আমরা সফল ধরে
     * অর্ডার `SHIPPED` করে দিতাম, আর কেউ পণ্যটা নিতেই আসত না।
     */
    it('treats a failure inside a 200 as a failure', async () => {
      stubFetch(200, { status: 400, message: 'Invoice already used' });

      const result = await provider.createParcel(parcel, context);

      expect(result.ok).toBe(false);
    });

    /** উত্তরের আকার অপ্রত্যাশিত হলেও crash নয় — স্পষ্ট ত্রুটি। */
    it('handles a response shape it does not recognise', async () => {
      stubFetch(200, { unexpected: true });

      const result = await provider.createParcel(parcel, context);

      expect(result.ok).toBe(false);
    });

    /** নেটওয়ার্ক ভাঙলে — retry করা যায়। */
    it('marks a network failure as worth retrying', async () => {
      globalThis.fetch = (() => Promise.reject(new Error('ECONNRESET'))) as typeof fetch;

      const result = await provider.createParcel(parcel, context);

      expect(result.ok).toBe(false);

      if (!result.ok) {
        expect(result.retryable).toBe(true);
      }
    });
  });

  describe('reading a parcel status', () => {
    /**
     * **`delivered_approval_pending` ≠ `DELIVERED`।**
     *
     * ডকে স্পষ্ট লেখা: "Do not settle your books on it — wait for
     * delivered, partial_delivered or cancelled." রাইডার বলেছে
     * পৌঁছেছে, কিন্তু Steadfast-এর হিসাব বিভাগ নিশ্চিত করেনি।
     *
     * `DELIVERED` ধরে নিলে অর্ডার সম্পন্ন দেখাত অথচ COD-র টাকা
     * এখনো আসেনি — আর পরে বাতিল হলে হিসাব মিলত না।
     */
    it('does not treat a rider-claimed delivery as delivered', async () => {
      stubFetch(200, { status: 200, delivery_status: 'delivered_approval_pending' });

      const result = await provider.track('1234', context);

      expect(result.ok).toBe(true);

      if (result.ok) {
        expect(result.status).toBe('IN_TRANSIT');
        // কাঁচা মান রাখা হয়, যাতে অ্যাডমিন আসল অবস্থা দেখতে পারে
        expect(result.rawStatus).toBe('delivered_approval_pending');
      }
    });

    it('maps a confirmed delivery', async () => {
      stubFetch(200, { status: 200, delivery_status: 'delivered' });

      const result = await provider.track('1234', context);

      if (result.ok) {
        expect(result.status).toBe('DELIVERED');
      }
    });

    /**
     * `cancelled` মানে পার্সেল **ফেরত আসছে**, বাতিল নয়।
     *
     * ডকে লেখা: "Not delivered and confirmed. The parcel comes back
     * to you." আমাদের `CANCELLED` মানে পাঠানোই হয়নি — দুটো আলাদা।
     * `CANCELLED` ধরলে পণ্য ফেরত আসছে সেটা কেউ জানত না আর স্টকে
     * যোগও হতো না।
     */
    it('maps a confirmed non-delivery to RETURNED, not CANCELLED', async () => {
      stubFetch(200, { status: 200, delivery_status: 'cancelled' });

      const result = await provider.track('1234', context);

      if (result.ok) {
        expect(result.status).toBe('RETURNED');
      }
    });

    it('maps a partial delivery to RETURNED as well', async () => {
      stubFetch(200, { status: 200, delivery_status: 'partial_delivered' });

      const result = await provider.track('1234', context);

      if (result.ok) {
        // অংশ ফেরত আসছে, তাই অ্যাডমিনের দেখা দরকার
        expect(result.status).toBe('RETURNED');
      }
    });

    it('keeps a parcel pending while it is in review', async () => {
      stubFetch(200, { status: 200, delivery_status: 'in_review' });

      const result = await provider.track('1234', context);

      if (result.ok) {
        expect(result.status).toBe('PENDING');
      }
    });

    /**
     * `hold` আর `exceptional` — ডকে লেখা "Contact support"।
     *
     * এগুলো কোনো স্বাভাবিক অবস্থায় map করা হয় না: করলে অ্যাডমিন
     * ভাবত সব ঠিক চলছে, অথচ পার্সেল আটকে আছে বা হারিয়ে গেছে।
     */
    it('does not map a held or lost parcel to a normal status', async () => {
      for (const raw of ['hold', 'exceptional', 'unknown']) {
        stubFetch(200, { status: 200, delivery_status: raw });

        const result = await provider.track('1234', context);

        expect(result.ok).toBe(false);

        if (!result.ok) {
          expect(result.message).toContain(raw);
        }
      }
    });
  });

  describe('the webhook', () => {
    const secret = 'webhook-secret-value';

    const body = {
      notification_type: 'delivery_status',
      consignment_id: 4455,
      invoice: 'ORD-1',
      delivery_status: 'delivered',
      updated_at: '2026-11-24T10:00:00+06:00',
    };

    const signed = (payload: unknown): Record<string, string> => ({
      'x-steadfast-signature': createHmac('sha256', secret)
        .update(JSON.stringify(payload), 'utf8')
        .digest('hex'),
    });

    it('accepts a correctly signed webhook', () => {
      const update = provider.parseWebhook(body, signed(body), secret);

      expect(update).not.toBeNull();
      expect(update?.consignmentId).toBe('4455');
      expect(update?.status).toBe('DELIVERED');
    });

    /**
     * **secret ছাড়া কিছুই নেওয়া হয় না।**
     *
     * নিলে যে কেউ "delivered" পাঠিয়ে অর্ডার সম্পন্ন দেখাত আর COD-র
     * টাকা না পেয়েই হিসাব মিলে যেত।
     */
    it('refuses everything when no secret is configured', () => {
      expect(provider.parseWebhook(body, signed(body), null)).toBeNull();
    });

    it('refuses a wrong signature', () => {
      expect(
        provider.parseWebhook(body, { 'x-steadfast-signature': 'deadbeef' }, secret),
      ).toBeNull();
    });

    it('refuses a missing signature', () => {
      expect(provider.parseWebhook(body, {}, secret)).toBeNull();
    });

    /** body বদলালে signature মেলে না — পথে কেউ অবস্থা বদলালে ধরা পড়ে। */
    it('refuses a tampered body', () => {
      const tampered = { ...body, delivery_status: 'cancelled' };

      expect(provider.parseWebhook(tampered, signed(body), secret)).toBeNull();
    });

    /**
     * রাইডারের দাবি webhook-এও `DELIVERED` নয়।
     *
     * webhook দিয়ে এটা এলে আর `DELIVERED` ধরলে অর্ডার সম্পন্ন
     * দেখাত — অথচ Steadfast নিজেই তখনো নিশ্চিত করেনি।
     */
    it('does not accept a rider-claimed delivery as delivered', () => {
      const claim = { ...body, delivery_status: 'delivered_approval_pending' };
      const update = provider.parseWebhook(claim, signed(claim), secret);

      expect(update?.status).toBe('IN_TRANSIT');
    });

    /** অন্য ধরনের notification (payout, return) — আমাদের কাজে লাগে না। */
    it('ignores a notification that is not about delivery', () => {
      const payout = { ...body, notification_type: 'payment' };

      expect(provider.parseWebhook(payout, signed(payout), secret)).toBeNull();
    });

    /** অজানা অবস্থা — অনুমান করা হয় না। */
    it('ignores a status it does not know', () => {
      const odd = { ...body, delivery_status: 'teleported' };

      expect(provider.parseWebhook(odd, signed(odd), secret)).toBeNull();
    });

    it('ignores a body that is not shaped like a webhook', () => {
      expect(provider.parseWebhook('not an object', {}, secret)).toBeNull();
      expect(provider.parseWebhook(null, {}, secret)).toBeNull();
    });
  });
});
