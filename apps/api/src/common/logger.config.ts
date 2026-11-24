import { randomUUID } from 'node:crypto';
import type { Params } from 'nestjs-pino';
import type { IncomingMessage } from 'node:http';

/**
 * Structured log (pino) + request id।
 *
 * **কেন request id:** "এক কাস্টমারের জন্য ভেঙেছে" — এই অভিযোগের
 * উত্তর id ছাড়া দেওয়া যায় না। প্রতিটা log লাইনে একই id থাকলে
 * একটা request-এর পুরো পথ grep করে বের করা যায়।
 *
 * **কেন JSON:** grep করা যায়, আর পরে Loki/Datadog-এ সরাসরি ঢালা যায়।
 * dev-এ pino-pretty না থাকলে JSON-ই দেখাবে — চোখে ধাক্কা লাগে,
 * কিন্তু নির্ভরতা কম রাখাই ভালো।
 */

/**
 * log-এ **কখনো** যাবে না এমন জায়গা।
 *
 * log সাধারণত DB-র চেয়ে বেশি লোক দেখে আর কম সুরক্ষিত থাকে
 * (স্ক্রিনে, CI আউটপুটে, তৃতীয় পক্ষের log service-এ)। তাই
 * পাসওয়ার্ড, token আর cookie কাঁচা অবস্থায় যাওয়া চলবে না —
 * একবার log-এ ঢুকলে সেটা আর ফেরানো যায় না।
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["set-cookie"]',
  'res.headers["set-cookie"]',
  'req.body.password',
  'req.body.currentPassword',
  'req.body.newPassword',
  'req.body.refreshToken',
  'req.body.token',
  // ফোন নম্বর — ব্যক্তিগত তথ্য, log-এ রাখার দরকার নেই
  'req.body.phone',
  'req.body.address.phone',
];

export const REQUEST_ID_HEADER = 'x-request-id';

/** মান মুছে এটাই বসে — আসল মানের কোনো আভাস রাখা হয় না। */
export const REDACT_CENSOR = '[redacted]';

/**
 * request id তৈরি বা পুনর্ব্যবহার।
 *
 * reverse proxy বা ক্লায়েন্ট id পাঠালে সেটাই রাখা হয় — তাহলে web
 * আর api-র log একই id-তে জোড়া যায়। না পাঠালে নিজে বানানো হয়।
 *
 * আলাদা করে export করা হয়েছে যাতে টেস্ট সরাসরি ডাকতে পারে:
 * `pinoHttp` একটা union type, তার ভেতর থেকে ফাংশন বের করতে গেলে
 * টাইপ কাস্ট করতে হতো, আর এই প্রজেক্টে `any` নিষেধ।
 */
/**
 * এই ফাংশনের যতটুকু দরকার ততটুকুই।
 *
 * `ServerResponse['setHeader']` নিজেকে ফেরত দেয় (chaining-এর জন্য),
 * কিন্তু এখানে সেই মান কখনো ব্যবহার হয় না। return type `unknown`
 * রাখলে আসল `ServerResponse`-ও খাপ খায়, টেস্টের হালকা নকলটাও।
 */
type HeaderWritable = {
  setHeader(name: string, value: string): unknown;
};

export const generateRequestId = (
  request: Pick<IncomingMessage, 'headers'>,
  response: HeaderWritable,
): string => {
  const existing = request.headers[REQUEST_ID_HEADER];
  const id = typeof existing === 'string' && existing.length > 0 ? existing : randomUUID();

  // ক্লায়েন্ট সাপোর্টকে id-টা বলতে পারে, তাই response-এও দেওয়া হয়
  response.setHeader(REQUEST_ID_HEADER, id);

  return id;
};

export const loggerConfig = (): Params => ({
  pinoHttp: {
    level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),

    /**
     * টেস্টে log বন্ধ। চালু থাকলে প্রতিটা request-এর JSON লাইন
     * jest-এর আউটপুট ভরিয়ে দেয় আর কোন টেস্ট ভাঙল সেটাই দেখা যায় না।
     * `jest-setup.ts` এই ফ্ল্যাগ বসায়।
     */
    enabled: process.env.LOG_SILENT !== 'true',

    genReqId: generateRequestId,

    redact: {
      paths: REDACT_PATHS,
      censor: REDACT_CENSOR,
    },

    /**
     * `/health` প্রতি কয়েক সেকেন্ডে আসে — log করলে আসল ঘটনা
     * ঢাকা পড়ে যেত। 4xx/5xx হলে তখন দেখানো হয়।
     */
    autoLogging: {
      ignore: (request: IncomingMessage): boolean => request.url === '/health',
    },

    customLogLevel: (_request, response, error): 'error' | 'warn' | 'info' => {
      if (error !== undefined || response.statusCode >= 500) {
        return 'error';
      }

      if (response.statusCode >= 400) {
        return 'warn';
      }

      return 'info';
    },
  },
});
