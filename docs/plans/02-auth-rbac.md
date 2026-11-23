# Phase 02 — Auth + RBAC

**লক্ষ্য:** কাস্টমার রেজিস্টার/লগইন করতে পারে, টোকেন রিফ্রেশ হয়, লগআউটে refresh টোকেন মরে যায়। ৫টা role আছে আর guard দিয়ে route আটকানো যায়। প্রথম Super Admin seed থেকে আসে।

**Done মানে:** নিচের Verification-এর সব কমান্ড পাস করে। UI এই phase-এ নেই — শুধু API + Next middleware। লগইন ফর্ম Phase 03-এ ক্যাটালগের সাথে আসবে।

---

## ১. ডিজাইন সিদ্ধান্ত (আগে পড়ো, পরে কোড)

| প্রশ্ন | সিদ্ধান্ত | কেন |
|---|---|---|
| পাসওয়ার্ড হ্যাশ | **argon2id** (`argon2` প্যাকেজ) | bcrypt-এর ৭২ বাইট সীমা নেই, GPU-প্রতিরোধী। schema-র কমেন্টে আগেই লেখা |
| Access token | JWT, **15m**, memory-তে (JS variable) | XSS-এ localStorage পড়া যায়, তাই সেখানে নয় |
| Refresh token | **opaque random (32 byte hex)**, DB-তে hash করে, 7d | JWT refresh revoke করা যায় না; DB row মুছলেই সেশন শেষ |
| Refresh কোথায় | **httpOnly + sameSite=lax + secure (prod)** cookie, path `/auth` | JS পড়তে পারে না, CSRF-এ sameSite বাঁচায় |
| Rotation | প্রতি refresh-এ পুরোনোটা মুছে নতুন দেওয়া | চুরি হলে একবারই কাজে লাগবে |
| Reuse detection | মুছে ফেলা টোকেন আবার এলে → ওই ইউজারের **সব** সেশন মুছে দাও | চুরির স্পষ্ট সংকেত |
| Role | DB enum `Role` (৫টা) | `packages/shared`-এর constant-এর সাথে হুবহু মিল |

**মনে রাখো:** master plan-এ "৪টা role" লেখা আছে — ওটা admin-side role বোঝাচ্ছে। `CUSTOMER` সহ মোট **৫টা**, যা `schema.prisma`-তে আছে।

---

## ২. Prisma — `RefreshToken` model

`apps/api/prisma/schema.prisma`-তে যোগ করো (`User` model ইতিমধ্যে আছে):

```prisma
model RefreshToken {
  id        String   @id @default(cuid())
  /// কাঁচা টোকেন নয় — sha256 hash. DB লিক হলেও সেশন হাইজ্যাক হবে না
  tokenHash String   @unique
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  expiresAt DateTime
  createdAt DateTime @default(now())
  /// audit — কোন device/IP থেকে এসেছিল
  userAgent String?
  ip        String?

  @@index([userId])
  @@index([expiresAt])
  @@map("refresh_tokens")
}
```

`User` model-এ relation যোগ করো: `refreshTokens RefreshToken[]`

তারপর: `npm run db:migrate -- --name add_refresh_token`

---

## ৩. `packages/shared` — schema + type

| ফাইল | কী থাকবে |
|---|---|
| `src/schemas/auth.ts` | `registerSchema` (email, password ≥8 + ১ digit, name ২-৬০, phone optional BD `^01[3-9]\d{8}$`), `loginSchema`, `AuthTokens`, `AuthUser` |
| `src/constants/roles.ts` | আগে থেকেই আছে — শুধু যাচাই করো enum-এর সাথে মিল আছে কিনা |

Zod schema **দুই পাশে** ব্যবহার হবে — API-তে validation, web-এ ফর্ম। ডুপ্লিকেট করবে না।

---

## ৪. `apps/api/src/modules/auth`

```
auth/
├── auth.module.ts
├── auth.controller.ts      POST register|login|refresh|logout, GET me
├── auth.service.ts         business logic
├── token.service.ts        JWT sign/verify + refresh rotation
├── guards/
│   ├── jwt-auth.guard.ts   global (APP_GUARD), @Public() দিয়ে বাদ
│   └── roles.guard.ts      @Roles(Role.SUPER_ADMIN)
├── decorators/
│   ├── public.decorator.ts
│   ├── roles.decorator.ts
│   └── current-user.decorator.ts
└── dto/                    Zod pipe দিয়ে validate
```

**Endpoint:**

| Method | Path | কী করে |
|---|---|---|
| POST | `/auth/register` | CUSTOMER বানায়, টোকেন দেয়। role বাইরে থেকে পাঠানো যাবে **না** |
| POST | `/auth/login` | ভুল হলে সবসময় একই বার্তা — "Invalid credentials" |
| POST | `/auth/refresh` | cookie থেকে পড়ে, rotate করে |
| POST | `/auth/logout` | DB row মোছে + cookie clear |
| GET | `/auth/me` | current user (password ছাড়া) |

**নিরাপত্তা নিয়ম:**
- response-এ `password` কখনো যাবে না — service থেকেই `select` দিয়ে বাদ
- ইমেইল আছে কি নেই, ফাঁস করবে না (register-এ "already exists" ঠিক আছে, login-এ নয়)
- `isActive: false` হলে লগইন আটকাবে
- login-এ rate limit — **Phase 15-এ** `@nestjs/throttler` দিয়ে, এখানে TODO কমেন্ট

---

## ৫. `apps/api/prisma/seed.ts` — প্রথম Super Admin

এখন ফাঁকা। লিখতে হবে:

- `.env` থেকে `SEED_ADMIN_EMAIL` + `SEED_ADMIN_PASSWORD` পড়বে
- না থাকলে **error দিয়ে থামবে** — হার্ডকোড করা পাসওয়ার্ড নয়
- `upsert` — বারবার চালালেও একটাই থাকবে
- `.env.example`-এ দুটো key যোগ করো

---

## ৬. `apps/web` — middleware + session

| ফাইল | কী থাকবে |
|---|---|
| `middleware.ts` | `(admin)` ও `(account)` route group পাহারা। refresh cookie নেই → `/login`-এ redirect |
| `lib/auth/session.ts` | server component-এর জন্য `getSession()` |
| `lib/auth/client.ts` | access token memory-তে, 401-এ একবার refresh করে retry |

**UI এই phase-এ নয়** — শুধু middleware যে আটকাচ্ছে সেটা টেস্টে প্রমাণ হবে।

---

## Task Checklist

- [ ] `RefreshToken` model + migration
- [ ] `packages/shared`-এ auth schema, দুই app-এ import করে দেখা
- [ ] `argon2` + `@nestjs/jwt` + `cookie-parser` install
- [ ] **টেস্ট আগে:** `auth.e2e-spec.ts` — register → login → me → refresh → logout
- [ ] **টেস্ট আগে:** `auth-security.e2e-spec.ts` — ভুল পাসওয়ার্ড, ডুপ্লিকেট ইমেইল, মেয়াদোত্তীর্ণ টোকেন, reuse detection, inactive user, response-এ password নেই
- [ ] **টেস্ট আগে:** `roles.guard.spec.ts` — CUSTOMER admin route-এ 403
- [ ] `TokenService` + `AuthService` + controller লিখে টেস্ট সবুজ
- [ ] Global `JwtAuthGuard` + `@Public()` — `/health` যেন খোলা থাকে
- [ ] `seed.ts` + `.env.example` key
- [ ] Next middleware + session helper + টেস্ট
- [ ] Verification পাস → `PROGRESS.md` ✅ → commit

---

## Verification

```bash
npm run db:migrate
npm run db:seed                       # Super Admin তৈরি
npm run dev

# register
curl -i -X POST localhost:4000/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"a@b.com","password":"secret123","name":"Test"}'
# → 201, body-তে accessToken, Set-Cookie-তে refreshToken (HttpOnly)

# me — টোকেন ছাড়া
curl -i localhost:4000/auth/me                        # → 401

# me — টোকেন সহ
curl -i localhost:4000/auth/me -H "authorization: Bearer <token>"
# → 200, body-তে password নেই

curl -i localhost:4000/health                         # → 200 (@Public কাজ করছে)

npm run test && npm run lint && npm run build         # সব সবুজ
```

**হাতে যাচাই করো:**
1. লগইন করে refresh cookie নিয়ে `/auth/refresh` — নতুন টোকেন আসে
2. **একই পুরোনো refresh টোকেন দ্বিতীয়বার** পাঠাও → 401, আর ওই ইউজারের সব সেশন মরে যায়
3. ব্রাউজারে `document.cookie` → refresh টোকেন দেখা **যাবে না** (httpOnly)
4. CUSTOMER টোকেন দিয়ে admin-only route → 403

---

## পরের Phase

`03-catalog.md` — Product + ProductVariant + স্টক CRUD, storefront ক্যাটালগ ও PDP। লগইন/রেজিস্টার **UI** ওখানে আসবে।
