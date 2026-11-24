import {
  generateRequestId,
  REDACT_CENSOR,
  REDACT_PATHS,
  REQUEST_ID_HEADER,
} from '../src/common/logger.config';

/**
 * log-এ সংবেদনশীল কিছু যাচ্ছে কিনা — DB ছাড়াই যাচাই করা যায়।
 *
 * **কেন এটা গুরুত্বপূর্ণ:** log সাধারণত DB-র চেয়ে বেশি লোক দেখে আর
 * কম সুরক্ষিত থাকে (স্ক্রিনে, CI আউটপুটে, তৃতীয় পক্ষের log service-এ)।
 * একবার পাসওয়ার্ড log-এ ঢুকলে সেটা আর ফেরানো যায় না — তাই ঢোকার
 * পথটাই বন্ধ রাখতে হবে, আর টেস্ট দিয়ে বন্ধ রাখা নিশ্চিত করতে হবে।
 */
describe('logger redaction', () => {
  it('hides the authorization header', () => {
    expect(REDACT_PATHS).toContain('req.headers.authorization');
  });

  /** cookie-তে refresh token থাকে — log-এ গেলে সেশন হাইজ্যাক করা যায়। */
  it('hides cookies in both directions', () => {
    expect(REDACT_PATHS).toContain('req.headers.cookie');
    expect(REDACT_PATHS).toContain('res.headers["set-cookie"]');
  });

  it('hides every password field', () => {
    expect(REDACT_PATHS).toContain('req.body.password');
    expect(REDACT_PATHS).toContain('req.body.currentPassword');
    expect(REDACT_PATHS).toContain('req.body.newPassword');
  });

  it('hides tokens sent in the body', () => {
    expect(REDACT_PATHS).toContain('req.body.refreshToken');
    expect(REDACT_PATHS).toContain('req.body.token');
  });

  /** ফোন নম্বর ব্যক্তিগত তথ্য — log-এ রাখার কোনো দরকার নেই। */
  it('hides phone numbers, including the one inside a checkout address', () => {
    expect(REDACT_PATHS).toContain('req.body.phone');
    expect(REDACT_PATHS).toContain('req.body.address.phone');
  });

  it('replaces the value instead of leaving a hint of it', () => {
    expect(REDACT_CENSOR).toBe('[redacted]');
  });
});

/**
 * request id — "এক কাস্টমারের জন্য ভেঙেছে" এই অভিযোগের উত্তর
 * id ছাড়া দেওয়া যায় না।
 */
describe('request id', () => {
  /** header লিখে রাখে এমন একটা হালকা নকল response। */
  const fakeResponse = (): {
    headers: Record<string, string>;
    setHeader: (name: string, value: string) => void;
  } => {
    const headers: Record<string, string> = {};

    return {
      headers,
      setHeader: (name: string, value: string): void => {
        headers[name] = value;
      },
    };
  };

  /**
   * ক্লায়েন্ট বা proxy id পাঠালে সেটাই রাখা হয় — তাহলে web আর
   * api-র log একই id-তে জোড়া যায়।
   */
  it('reuses an id the caller supplied', () => {
    const response = fakeResponse();

    const id = generateRequestId({ headers: { [REQUEST_ID_HEADER]: 'given-id' } }, response);

    expect(id).toBe('given-id');
    expect(response.headers[REQUEST_ID_HEADER]).toBe('given-id');
  });

  it('makes one up when the caller sent none', () => {
    const response = fakeResponse();

    const id = generateRequestId({ headers: {} }, response);

    expect(id.length).toBeGreaterThan(10);
    expect(response.headers[REQUEST_ID_HEADER]).toBe(id);
  });

  /** খালি header-কে "আছে" ধরলে সব request একই ফাঁকা id পেত। */
  it('ignores an empty header and makes its own', () => {
    const response = fakeResponse();

    const id = generateRequestId({ headers: { [REQUEST_ID_HEADER]: '' } }, response);

    expect(id.length).toBeGreaterThan(10);
  });

  /** দুটো request কখনো একই id পাবে না, নইলে log জোড়া দেওয়া অর্থহীন। */
  it('gives a different id each time', () => {
    const first = generateRequestId({ headers: {} }, fakeResponse());
    const second = generateRequestId({ headers: {} }, fakeResponse());

    expect(first).not.toBe(second);
  });
});
