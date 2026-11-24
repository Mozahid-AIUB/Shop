import { Logger } from '@nestjs/common';
import type { ProviderContext } from '../courier.provider';

/**
 * Pathao-র OAuth টোকেন সামলানো।
 *
 * **adapter থেকে আলাদা রাখা হয়েছে** কারণ এটা আলাদা দায়িত্ব:
 * পার্সেল বানানো আর টোকেনের জীবনচক্র দুটো ভিন্ন জিনিস। একই ফাইলে
 * থাকলে "পার্সেলে কী পাঠাচ্ছি" খুঁজতে গিয়ে টোকেনের কোডের ভেতর
 * দিয়ে যেতে হতো।
 *
 * **কেন টোকেন লাগে:** Pathao প্রতিটা কলে static key নেয় না। আগে
 * `/issue-token` ডেকে টোকেন নিতে হয়, মেয়াদ ৫ দিন।
 *
 * **কেন জমা রাখা হয়:** প্রতিটা পার্সেলে নতুন টোকেন চাইলে দুটো কল
 * লাগত আর তাদের দিকে অর্থহীন লোড যেত। মেমরিতে রাখলে সার্ভার
 * রিস্টার্টেই হারাত, আর একাধিক সার্ভার চালালে প্রত্যেকে আলাদা
 * টোকেন নিত।
 */

/**
 * মেয়াদ শেষের কত আগে নতুন টোকেন নেব।
 *
 * ঠিক মেয়াদ শেষের মুহূর্তে নিলে কলটা মাঝপথে অচল হয়ে যেতে পারত —
 * তখন পার্সেল তৈরি হয়নি অথচ কারণটা অস্পষ্ট। ৫ মিনিট যথেষ্ট আগাম।
 */
const SAFETY_WINDOW_MS = 5 * 60 * 1000;

/** জমানো টোকেনের আকার — `oauthToken` কলামে JSON হিসেবে বসে। */
export type StoredToken = {
  accessToken: string;
  refreshToken: string | null;
  /** epoch ms — এর পরে টোকেন অচল */
  expiresAt: number;
};

export type TokenFailure = { ok: false; message: string; retryable: boolean };

export type TokenResult = { ok: true; accessToken: string } | { ok: false; failure: TokenFailure };

/** HTTP কল — adapter-এর নিজের `call()` এখানে পাস করা হয়। */
export type TokenFetcher = (
  path: string,
  init: RequestInit,
) => Promise<{ ok: true; body: unknown } | { ok: false; failure: TokenFailure }>;

const logger = new Logger('PathaoToken');

const asText = (value: unknown): string | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
};

/**
 * জমানো টোকেন পড়া।
 *
 * **খুলতে না পারলে `null`, throw নয়** — এনক্রিপশনের চাবি বদলালে বা
 * row হাতে বদলালে এটা ঘটতে পারে। তখন হাল ছাড়ার কিছু নেই: নতুন
 * টোকেন নিয়ে নিলেই হয়। throw করলে দোকান পার্সেলই পাঠাতে পারত না।
 */
export const readStoredToken = (raw: string | null | undefined): StoredToken | null => {
  if (raw === null || raw === undefined || raw === '') {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }

  const record = parsed as Record<string, unknown>;
  const accessToken = asText(record['accessToken']);
  const expiresAt = record['expiresAt'];

  if (accessToken === null || typeof expiresAt !== 'number') {
    return null;
  }

  return { accessToken, refreshToken: asText(record['refreshToken']), expiresAt };
};

/** জমানো টোকেন এখনো কাজে লাগবে কিনা। */
export const isUsable = (token: StoredToken | null): token is StoredToken =>
  token !== null && token.expiresAt - SAFETY_WINDOW_MS > Date.now();

/**
 * নতুন টোকেন নেওয়া।
 *
 * **refresh token ব্যবহার করা হয় না**, ইচ্ছাকৃতভাবে। ডকে দুটো পথই
 * আছে, কিন্তু password grant একটাই কল আর সবসময় কাজ করে। refresh
 * ব্যর্থ হলে আবার password grant-এ ফিরতে হতো — মানে দুটো পথ, দুটো
 * ব্যর্থতার ধরন, আর বাড়তি কিছু না পেয়ে।
 */
export const issueToken = async (
  context: ProviderContext,
  fetcher: TokenFetcher,
): Promise<TokenResult> => {
  const { credentials } = context;

  const response = await fetcher('/aladdin/api/v1/issue-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: credentials['clientId'] ?? '',
      client_secret: credentials['clientSecret'] ?? '',
      grant_type: 'password',
      username: credentials['username'] ?? '',
      password: credentials['password'] ?? '',
    }),
  });

  if (!response.ok) {
    return { ok: false, failure: response.failure };
  }

  const body = response.body as Record<string, unknown> | null;
  const accessToken = asText(body?.['access_token']);

  if (accessToken === null) {
    return {
      ok: false,
      failure: {
        ok: false,
        message: 'Pathao টোকেন দেয়নি — client id, secret, ইমেইল ও পাসওয়ার্ড মিলিয়ে দেখুন',
        retryable: false,
      },
    };
  }

  await store(context, {
    accessToken,
    refreshToken: asText(body?.['refresh_token']),
    expiresAt: Date.now() + lifetimeMs(body?.['expires_in']),
  });

  return { ok: true, accessToken };
};

const lifetimeMs = (expiresIn: unknown): number =>
  typeof expiresIn === 'number' && Number.isFinite(expiresIn) ? expiresIn * 1000 : 0;

/**
 * টোকেন জমা রাখা — **ব্যর্থ হলেও পার্সেল পাঠানো থামে না**।
 *
 * টোকেনটা হাতে আছে, কাজ চলবে; শুধু পরের বার আবার নিতে হবে।
 * এখানে throw করলে DB-র একটা সাময়িক সমস্যায় অর্ডার আটকে যেত।
 */
const store = async (context: ProviderContext, token: StoredToken): Promise<void> => {
  if (context.saveOauthToken === undefined) {
    return;
  }

  try {
    await context.saveOauthToken(JSON.stringify(token));
  } catch (error) {
    logger.warn(
      `Could not store the Pathao token: ${error instanceof Error ? error.message : 'unknown'}`,
    );
  }
};
