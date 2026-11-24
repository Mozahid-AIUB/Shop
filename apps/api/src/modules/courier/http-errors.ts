/**
 * কুরিয়ারের HTTP ত্রুটি আমাদের বার্তায় — **সব adapter এটাই ব্যবহার করে**।
 *
 * **কেন এক জায়গায়:** তিনটা কুরিয়ারের ত্রুটির কোড একই অর্থ বহন করে
 * (৪০১ = key ভুল, ৪২২ = মাঠ ভুল, ৫xx = তাদের দোষ), আর প্রতিটা
 * adapter নিজে লিখলে কোথাও `retryable` ভুল বসত।
 *
 * **`retryable` ভুল হওয়ার দাম:** Steadfast-এর ডকে লেখা, একই ঠিকানা
 * থেকে ৫ মিনিটে ১০ বার ভুল key দিলে **৬০ মিনিট** আটকে যায় — ঠিক key
 * দিলেও। তাই ৪০১-এ কখনো retry নয়, নইলে key ঠিক করার পরেও দোকান এক
 * ঘণ্টা পার্সেল পাঠাতে পারত না।
 */

export type CourierFailure = { ok: false; message: string; retryable: boolean };

const asRecord = (body: unknown): Record<string, unknown> | null =>
  typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : null;

/** কুরিয়ারের নিজের বার্তা, থাকলে। */
export const messageFrom = (body: unknown): string | null => {
  const message = asRecord(body)?.['message'];

  return typeof message === 'string' && message.trim() !== '' ? message.trim() : null;
};

/**
 * কোন মাঠ কী কারণে বাতিল হলো।
 *
 * মাঠের নাম রাখা হয় (`recipient_phone`), কারণ অ্যাডমিনকে জানতে হবে
 * কোথায় ঠিক করতে হবে। শুধু "validation error" বললে সে অর্ডারের সব
 * মাঠ হাতড়াত।
 */
export const fieldErrors = (body: unknown, fallback: string): string => {
  const errors = asRecord(body)?.['errors'];

  if (errors === undefined || typeof errors !== 'object' || errors === null) {
    return messageFrom(body) ?? fallback;
  }

  const parts = Object.entries(errors).map(([field, messages]) => {
    const first = Array.isArray(messages) ? messages[0] : messages;

    return `${field}: ${String(first)}`;
  });

  return parts.length === 0 ? fallback : parts.join('; ');
};

/**
 * HTTP কোড → অ্যাডমিনকে দেখানোর বার্তা।
 *
 * `courierName` বার্তায় বসে, যাতে একাধিক কুরিয়ার চালালে অ্যাডমিন
 * বোঝে কোনটায় সমস্যা।
 */
export const translateHttpError = (
  status: number,
  body: unknown,
  courierName: string,
): CourierFailure => {
  if (status === 401) {
    return {
      ok: false,
      message: `${courierName}-এর API credential ভুল বা বাতিল — প্যানেল থেকে আবার বসান`,
      retryable: false,
    };
  }

  if (status === 403) {
    return {
      ok: false,
      message: `${courierName} অ্যাকাউন্টে এই কাজের অনুমতি নেই — তাদের সাথে যোগাযোগ করুন`,
      retryable: false,
    };
  }

  if (status === 422 || status === 400) {
    return {
      ok: false,
      message: fieldErrors(body, `${courierName} তথ্য নেয়নি`),
      retryable: false,
    };
  }

  if (status === 429) {
    return {
      ok: false,
      message: `${courierName}-এ অনেক বেশি অনুরোধ গেছে — কিছুক্ষণ পর আবার চেষ্টা করুন`,
      retryable: true,
    };
  }

  if (status >= 500) {
    /**
     * তাদের দোষ — retry করা যায়।
     *
     * দুবার বুক হওয়ার ভয় নেই: কুরিয়াররা একই invoice দুবার নেয় না
     * (Steadfast-এর ডকে স্পষ্ট লেখা), আর আমরা প্রতিটা পার্সেলে
     * আলাদা reference পাঠাই।
     */
    return {
      ok: false,
      message: `${courierName}-এর সার্ভারে সমস্যা — আবার চেষ্টা করুন`,
      retryable: true,
    };
  }

  return {
    ok: false,
    message: messageFrom(body) ?? `${courierName} ${status} দিয়েছে`,
    retryable: false,
  };
};

/** নেটওয়ার্ক ভাঙা — retry করা যায়। */
export const unreachable = (courierName: string): CourierFailure => ({
  ok: false,
  message: `${courierName}-এ পৌঁছানো গেল না — আবার চেষ্টা করুন`,
  retryable: true,
});
