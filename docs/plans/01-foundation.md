# Phase 01 — Foundation

**লক্ষ্য:** `docker compose up` দিলে Postgres + Redis + MinIO ওঠে, `npm run dev` দিলে API `:4000`-এ আর web `:3000`-এ চলে, `/health` DB ping সহ 200 দেয়, টেস্ট ও build সবুজ।

**Done মানে:** নিচের Verification-এর সব কমান্ড পাস করে। কোনো business feature এই phase-এ নেই — শুধু কঙ্কাল।

---

## ১. Monorepo root

| ফাইল | কী থাকবে |
|---|---|
| `package.json` | npm workspaces: `apps/*`, `packages/*`। Script: `dev` (concurrently api+web), `build`, `test`, `lint`, `db:migrate`, `db:studio`, `db:seed` |
| `.gitignore` | `node_modules`, `.next`, `dist`, `.env`, `*.log`, `coverage`, `.turbo`, MinIO data dir |
| `.env.example` | নিচের env সব key, ডামি ভ্যালু সহ |
| `.nvmrc` | `22` |
| `README.md` | ১ প্যারা পরিচয় + quick start (৪ লাইন কমান্ড) |

**Env keys (`.env.example`):**
```
DATABASE_URL=postgresql://tshirt:tshirt@localhost:5432/tshirt_db?schema=public
REDIS_URL=redis://localhost:6379
JWT_ACCESS_SECRET=change-me
JWT_REFRESH_SECRET=change-me-too
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=7d
S3_ENDPOINT=http://localhost:9000
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_BUCKET=tshirt-designs
API_PORT=4000
WEB_ORIGIN=http://localhost:3000
NEXT_PUBLIC_API_URL=http://localhost:4000
```

---

## ২. `docker/docker-compose.yml`

তিনটা service, সবগুলোতে **named volume + healthcheck**:

| Service | Image | Port | নোট |
|---|---|---|---|
| `postgres` | `postgres:17-alpine` | 5432 | user/pass/db = `tshirt`; healthcheck `pg_isready` |
| `redis` | `redis:8-alpine` | 6379 | BullMQ-র জন্য; healthcheck `redis-cli ping` |
| `minio` | `minio/minio` | 9000 (API), 9001 (Console) | `server /data --console-address ":9001"` |

এই phase-এ api/web **container-এ যাবে না** — host থেকে `npm run dev`-এ চলবে (dev loop দ্রুত থাকে)। App-এর Dockerfile আসবে Phase 12-এ।

`minio-init` নামে একটা one-shot service রাখো যেটা `mc` দিয়ে bucket তৈরি করে দেয় — নাহলে প্রতিবার হাতে বানাতে হবে।

---

## ৩. `apps/api` — NestJS 11

```
apps/api/
├── prisma/schema.prisma
├── src/
│   ├── main.ts                 # CORS (WEB_ORIGIN), ValidationPipe(whitelist), port API_PORT
│   ├── app.module.ts           # ConfigModule.forRoot({isGlobal:true}) + PrismaModule + HealthModule
│   ├── prisma/
│   │   ├── prisma.module.ts    # @Global()
│   │   └── prisma.service.ts   # PrismaClient extend, onModuleInit-এ $connect
│   └── health/
│       ├── health.module.ts
│       ├── health.controller.ts   # GET /health
│       └── health.service.ts      # SELECT 1 দিয়ে DB ping
└── test/health.e2e-spec.ts
```

`GET /health` response contract:
```json
{ "status": "ok", "db": "up", "uptime": 12.34, "timestamp": "2026-08-01T..." }
```
DB down হলে → `503` + `"db": "down"`। **এই আচরণটাই টেস্ট করতে হবে, শুধু happy path নয়।**

---

## ৪. `apps/web` — Next.js 16

```
apps/web/
├── app/
│   ├── layout.tsx        # Bangla font (Hind Siliguri) + Tailwind base
│   ├── page.tsx          # সাময়িক ল্যান্ডিং — API health status দেখাবে
│   └── globals.css       # Tailwind 4 (@import "tailwindcss")
├── lib/api.ts            # fetch wrapper, NEXT_PUBLIC_API_URL base
└── vitest.config.ts
```

হোমপেজ Phase 03-এ আসল ডিজাইন পাবে। এখন শুধু API-র সাথে সংযোগ আছে কিনা দেখানোর জন্য একটা কার্ড — এটাই phase-এর "চোখে দেখা" প্রমাণ।

---

## ৫. `packages/shared`

```
packages/shared/src/
├── index.ts
├── types/health.ts       # HealthResponse
└── constants/order.ts    # OrderStatus enum — Phase 06-এ লাগবে, এখনই এক জায়গায় থাক
```
`"main": "./src/index.ts"` — dev-এ সরাসরি TS resolve হবে, আলাদা build step নেই।

---

## ৬. Prisma — কঙ্কাল schema

Phase 01-এ শুধু **`User` + `Role` enum** — auth Phase 02-এ, কিন্তু migration pipeline আজই কাজ করা দরকার।

```prisma
enum Role { SUPER_ADMIN ORDER_MANAGER DESIGNER ACCOUNTANT CUSTOMER }

model User {
  id        String   @id @default(cuid())
  email     String   @unique
  phone     String?  @unique
  name      String
  password  String
  role      Role     @default(CUSTOMER)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@map("users")
}
```

`npm run db:migrate` → `prisma migrate dev --name init` চালিয়ে `apps/api/prisma/migrations/` তৈরি হবে।

---

## ৭. CI — `.github/workflows/ci.yml`

Push + PR-এ: Postgres service container তুলে → `npm ci` → `prisma migrate deploy` → `lint` → `test` → `build`। Node 22।

---

## Task Checklist

- [ ] Root `package.json` (workspaces + scripts), `.gitignore`, `.env.example`, `.nvmrc`
- [ ] `docker/docker-compose.yml` + minio-init, `docker compose up -d` করে ৩ service healthy দেখা
- [ ] `apps/api` scaffold + `PrismaService` + `main.ts` config
- [ ] Prisma schema + `migrate dev --name init` চালানো
- [ ] **টেস্ট আগে:** `health.e2e-spec.ts` — ok কেস + db-down কেস
- [ ] `HealthModule` লিখে টেস্ট সবুজ করা
- [ ] `apps/web` scaffold + Tailwind 4 + health কার্ড হোমপেজ
- [ ] `packages/shared` + দুই app-এ import করে দেখা
- [ ] `.github/workflows/ci.yml`
- [ ] রুট `README.md` quick start
- [ ] Verification-এর সব কমান্ড পাস
- [ ] `PROGRESS.md`-এ Phase 01 ✅, commit

---

## Verification

```bash
docker compose -f docker/docker-compose.yml up -d
docker compose -f docker/docker-compose.yml ps      # ৩টাই healthy

npm install
npm run db:migrate
npm run dev                                          # api :4000, web :3000

curl http://localhost:4000/health                    # {"status":"ok","db":"up",...}
# ব্রাউজারে localhost:3000 → সবুজ "API connected" কার্ড

npm run test && npm run lint && npm run build        # সব সবুজ
```

**DB-down কেসও হাতে যাচাই করো:** `docker compose stop postgres` → `/health` ৫০৩ দেবে → আবার `start` → ২০০। Health check যদি DB বন্ধ থাকা অবস্থাতেও ok বলে, সেটা কাজ করছে না।

---

## পরের Phase

`02-auth-rbac.md` লিখে তারপর execute — JWT access/refresh, ৫টা role, Nest guard + Next middleware।
