/**
 * কুরিয়ার — পার্সেল পাঠানো ও ট্র্যাক করা।
 *
 * **কিছু হার্ডকোড নয়:** কোন কুরিয়ার চালু, কোন key, কোনটা ডিফল্ট —
 * সব অ্যাডমিন প্যানেল থেকে। এই কোড অন্য ব্যবসায়ীদের কাছেও যাবে,
 * আর তাদের চুক্তি আলাদা কুরিয়ারের সাথে হবে।
 */

/**
 * যে কুরিয়ারগুলো সমর্থিত।
 *
 * `MANUAL` = নিজের লোকে ডেলিভারি, কোনো API নেই। **এটা সবসময় থাকে**
 * আর key লাগে না — নইলে যে দোকান এখনো কুরিয়ারের সাথে চুক্তি করেনি
 * সে অর্ডার পাঠাতেই পারত না।
 */
export const COURIERS = ['STEADFAST', 'PATHAO', 'REDX', 'CARRYBEE', 'MANUAL'] as const;

export type Courier = (typeof COURIERS)[number];

/** প্যানেলে দেখানোর নাম। */
export const COURIER_LABEL: Record<Courier, string> = {
  STEADFAST: 'Steadfast',
  PATHAO: 'Pathao',
  REDX: 'RedX',
  CARRYBEE: 'Carrybee',
  MANUAL: 'নিজের ডেলিভারি',
};

/**
 * পার্সেলের অবস্থা।
 *
 * কুরিয়ারের নিজের নাম এগুলোতে map হয় — প্রত্যেকের শব্দ আলাদা
 * ("delivered", "Delivered", "DELIVERED_TO_CUSTOMER"), কিন্তু
 * আমাদের দিকে একটাই তালিকা থাকলে অ্যাডমিন প্যানেল আর রিপোর্ট
 * সব কুরিয়ারে একইভাবে কাজ করে।
 */
export const SHIPMENT_STATUSES = [
  'PENDING',
  'PICKED_UP',
  'IN_TRANSIT',
  'DELIVERED',
  'RETURNED',
  'CANCELLED',
] as const;

export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

/** প্যানেলে দেখানোর নাম। */
export const SHIPMENT_STATUS_LABEL: Record<ShipmentStatus, string> = {
  PENDING: 'অপেক্ষায়',
  PICKED_UP: 'কুরিয়ার নিয়েছে',
  IN_TRANSIT: 'পথে আছে',
  DELIVERED: 'পৌঁছে গেছে',
  RETURNED: 'ফেরত এসেছে',
  CANCELLED: 'বাতিল',
};

/**
 * আর বদলাবে না এমন অবস্থা।
 *
 * webhook দেরিতে এলে এটা দিয়ে আটকানো হয়: `DELIVERED` হয়ে যাওয়া
 * পার্সেল পরে আসা "IN_TRANSIT" webhook-এ পিছিয়ে যাবে না। কুরিয়ারের
 * webhook ক্রমে আসে না, আর পিছিয়ে গেলে অ্যাডমিন ভাবত পার্সেল
 * হারিয়েছে।
 */
export const SHIPMENT_TERMINAL_STATUSES: readonly ShipmentStatus[] = [
  'DELIVERED',
  'RETURNED',
  'CANCELLED',
];

export const isShipmentTerminal = (status: ShipmentStatus): boolean =>
  SHIPMENT_TERMINAL_STATUSES.includes(status);

/**
 * শিপমেন্টের অবস্থা থেকে অর্ডারের অবস্থা।
 *
 * `null` = অর্ডারের অবস্থা বদলানোর দরকার নেই।
 *
 * **কেন সব mapping নেই:** `PICKED_UP` আর `IN_TRANSIT` দুটোই
 * অর্ডারের দিকে `SHIPPED` — অর্ডারের জীবনচক্রে এত সূক্ষ্ম ভাগ নেই,
 * আর থাকলে ক্রেতা ট্র্যাকিং পাতায় দুবার একই কথা দেখত।
 *
 * `RETURNED` অর্ডার বাতিল **করে না** — ফেরত আসা মানে ক্রেতা নেয়নি,
 * কিন্তু পণ্য দোকানে ফিরেছে আর টাকার হিসাব এখনো বাকি। সিদ্ধান্তটা
 * মানুষের (রিফান্ড? আবার পাঠানো?), তাই অ্যাডমিনকে দেখানো হয়।
 */
export const SHIPMENT_TO_ORDER_STATUS: Record<ShipmentStatus, 'SHIPPED' | 'DELIVERED' | null> = {
  PENDING: null,
  PICKED_UP: 'SHIPPED',
  IN_TRANSIT: 'SHIPPED',
  DELIVERED: 'DELIVERED',
  RETURNED: null,
  CANCELLED: null,
};

/**
 * প্রতিটা কুরিয়ারে কী কী credential লাগে।
 *
 * **প্যানেল এই তালিকা দেখে ফর্ম বানায়** — নইলে ফ্রন্টএন্ডে আবার
 * একই তথ্য লিখতে হতো, আর নতুন কুরিয়ার যোগ করলে দুই জায়গায়
 * বদলাতে হতো।
 *
 * মাঠগুলো আলাদা কারণ auth-র ধরনই আলাদা: Steadfast-এ দুটো static
 * key, Pathao-তে OAuth (চারটা মান, টোকেনের মেয়াদ শেষ হয়), RedX-এ
 * একটা JWT, Carrybee-তে client id + secret + context।
 */
export const COURIER_CREDENTIAL_FIELDS: Record<Courier, readonly string[]> = {
  STEADFAST: ['apiKey', 'secretKey'],
  PATHAO: ['clientId', 'clientSecret', 'username', 'password', 'storeId'],
  REDX: ['accessToken', 'pickupStoreId'],
  CARRYBEE: ['clientId', 'clientSecret', 'clientContext'],
  /** নিজের ডেলিভারিতে কোনো API নেই, তাই কিছুই লাগে না */
  MANUAL: [],
};

/** যে কুরিয়ারে API নেই — ট্র্যাকিং নম্বর হাতে বসাতে হয়। */
export const isManualCourier = (courier: Courier): boolean => courier === 'MANUAL';
