# Phase 13 — Hardening (আগে আনা হলো)

**লক্ষ্য:** খোলা endpoint-গুলোকে brute force ও স্ক্র্যাপিং থেকে বাঁচানো, HTTP header টাইট করা, আর log থেকে "কোন request-এ ভাঙল" বের করার উপায় রাখা।

**কেন ক্রম ভেঙে এখন:** `/track` লগইন ছাড়া খোলা আর Order ID অনুমানযোগ্য (`ORD-2026-1123-018` — তারিখ + সিরিয়াল)। rate limit ছাড়া কেউ স্ক্রিপ্ট দিয়ে ০০১ থেকে গুনে সব অর্ডার বের করে ফেলতে পারে: কে কী কিনেছে, কোথায় থাকে। login/register-ও খোলা, মানে credential stuffing বিনামূল্যে। প্রতি phase-এ নতুন endpoint যোগ হচ্ছে, তাই দেরি করলে বসানোর জায়গা বাড়তেই থাকবে।

**এই phase-এ নয়:** DB backup cron আর VPS deploy (আসল সার্ভার লাগবে), Playwright (UI লাগবে)। ওগুলো deploy-এর আগে, আলাদা phase-এ।

---

## ১. ডিজাইন সিদ্ধান্ত

| প্রশ্ন | সিদ্ধান্ত | কেন |
|---|---|---|
| Rate limit কোথায়? | গ্লোবাল guard + প্রতি-route আঁটসাঁট সীমা | গ্লোবাল না দিলে নতুন endpoint ডিফল্টে অরক্ষিত থাকত |
| গ্লোবাল সীমা | ১ মিনিটে ১০০ | সাধারণ ব্রাউজিং এতে আটকায় না |
| `/track` | ১ মিনিটে ১০ | অনুমান করে খোঁজা অকেজো করে দেয়, আসল কাস্টমারের কষ্ট হয় না |
| `/auth/login` | ১ মিনিটে ৫ | পাসওয়ার্ড অনুমান করা অসম্ভব করে তোলে |
| `/auth/register` | ১ ঘণ্টায় ১০ | ভুয়া অ্যাকাউন্টের বান ঠেকায় |
| গোনা হবে কী ধরে? | IP | লগইনের আগে ইউজার জানা থাকে না |
| স্টোরেজ? | মেমরিতে (এখন) | Redis এলে ওখানে সরবে, নইলে একাধিক instance-এ সীমা আলাদা হবে |
| Helmet | চালু, CSP সহ | API JSON দেয়, তাই CSP কড়া রাখা যায় |
| Log | pino, JSON | grep-able, আর পরে Loki/Datadog-এ ঢালা যায় |
| request id | প্রতি request-এ, response header-এ | "এক কাস্টমারের জন্য ভেঙেছে" — id ছাড়া এর উত্তর নেই |
| log-এ কী **যাবে না** | পাসওয়ার্ড, token, cookie, ফোন | log সাধারণত বেশি লোক দেখে, DB-র চেয়ে কম সুরক্ষিত |

**কেন মেমরি-ভিত্তিক rate limit এখন যথেষ্ট:** এক instance চলছে। Redis বসলে (Phase 08) throttler-এর storage ওখানে সরাবো — তখন একাধিক instance একই হিসাব দেখবে। এখন না করলে সুরক্ষাই থাকত না, আর সেটা খারাপ।

---

## ২. API-তে পরিবর্তন

নতুন endpoint নেই। যা বদলায়:

- সব route-এ গ্লোবাল throttle; `/health` বাদ (monitoring প্রতি সেকেন্ডে ডাকে)
- সীমা ছাড়ালে **429** + `Retry-After`
- প্রতি response-এ `x-request-id`

---

## Task Checklist

- [x] 13.1 **টেস্ট:** login-এ ৬ষ্ঠ চেষ্টায় 429, `/track`-এ ১১তম-এ 429
- [x] 13.2 **টেস্ট:** `/health` throttle হয় না
- [x] 13.3 `ThrottlerModule` + গ্লোবাল guard + প্রতি-route সীমা
- [x] 13.4 Helmet + CORS পুনরায় যাচাই
- [x] 13.5 pino logger + request id, সংবেদনশীল ফিল্ড redact
- [x] 13.6 **টেস্ট:** log-এ পাসওয়ার্ড/token যায় না
- [x] Verification → PROGRESS ✅ → commit → push

---

## Verification

```bash
rm -rf packages/shared/dist   # CI-র মতো অবস্থা
npm run lint && npm run test && npm run build
```

---

## পরের Phase

`09-reports.md` — sales aggregate, best seller, revenue vs due।
