# Review Checklist — this project's actual risk surface

Work through the sections that the diff touches. Skip the rest; a review that pretends to check untouched code is noise.

---

## A. Security

### Auth & sessions (Phase 02+)
- Password hashed with argon2/bcrypt — never plain, never MD5/SHA1, never reversible
- Password, refresh token and any hash **excluded from every API response** — check the Prisma `select`, not just the DTO
- Access token short-lived (15m); refresh token rotated on use, and reuse of an old refresh token invalidates the family
- Secrets read from env, never a literal in source, never a default like `'change-me'` reaching production
- Logout actually invalidates server-side; deleting the cookie alone is not logout
- Login/register/reset endpoints rate-limited — otherwise credential stuffing is free
- Timing-safe comparison for tokens and OTPs (`crypto.timingSafeEqual`)

### RBAC (Phase 02+)
- Every non-public route carries a guard. A missing decorator is a silent public endpoint — grep controllers for handlers with no guard
- Role checked **server-side**. Hiding an admin button in React protects nothing
- Ownership checked, not just role: a logged-in customer must not read `/orders/:id` belonging to someone else. This is the most commonly missed check in e-commerce
- `SUPER_ADMIN` cannot be self-assigned through any registration or profile-update path

### Prisma & data
- No raw SQL built by string concatenation. `$queryRaw` with a template literal is parameterised; `$queryRawUnsafe` with interpolation is an injection
- `select`/`omit` used on user-facing queries so new columns don't leak by default
- Multi-step writes wrapped in `$transaction` — order + items + payment must not half-commit
- Pagination has a hard max `take`; unbounded list endpoints are a denial-of-service vector
- Migrations are additive and reversible; no destructive change without an explicit plan

### File upload (Phase 04 — design studio)
This is the highest-risk surface in the whole product. Users upload arbitrary files.
- Content type validated by **magic bytes**, not the client-supplied `Content-Type` or file extension
- Hard size cap enforced server-side before the file is read into memory
- Stored filename generated server-side (cuid/uuid) — never the user's filename, which can contain `../` or a null byte
- SVG either rejected or sanitised: SVG carries `<script>` and is a stored-XSS delivery mechanism
- Uploads served from a separate origin or with `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`
- Bucket not publicly writable; presigned URLs short-lived and scoped to one key

### Payments (Phase 07)
- Amount recomputed **server-side** from the cart. Never trust an amount that came from the client
- Webhook signature verified before the payload is trusted or acted on
- Webhook handler idempotent — gateways retry, and a double-credit is a real loss
- Order marked paid only from the verified webhook, never from the browser redirect
- Gateway credentials in env; sandbox vs live driven by config, not by a code branch someone can forget to flip

### Web layer
- Input validated at the boundary with class-validator/Zod, `whitelist: true` so unknown fields are stripped
- CORS pinned to `WEB_ORIGIN`, not `*` — especially with credentials enabled
- No secret in `NEXT_PUBLIC_*`; that prefix ships the value to the browser
- Errors returned to clients are generic; stack traces and Prisma errors stay in the logs
- No `dangerouslySetInnerHTML` on user-supplied content

---

## B. Professional gaps — what a real store has and a demo doesn't

### Money
- Stored as **integer paisa**, never float. `0.1 + 0.2 !== 0.3` becomes a wrong invoice
- Currency explicit on every amount field
- Prices, discounts and totals computed in one place, not recalculated in three components

### Correctness under concurrency
- Order ID generation safe against two simultaneous orders (transaction + row lock, not `count() + 1`)
- Stock decrement atomic — two customers buying the last shirt must not both succeed
- Unique constraints in the **database**, not only validated in application code

### Operability
- Structured logs with a request/correlation id — "it broke for one customer" is unanswerable without it
- Health check reflects real dependencies (this repo's `/health` returns 503 when Postgres is down — keep that honest as Redis and S3 are added)
- Errors reaching an inbox or dashboard, not only stdout
- Background jobs retried with backoff and a dead-letter path

### Data & recovery
- Database backups automated **and a restore actually tested** — an untested backup is a guess
- Deletes soft where an audit trail matters (orders, payments, users)
- `createdAt`/`updatedAt` on every table
- Admin actions on orders and payments written to an activity log

### Frontend quality
- Loading, empty, and error states exist — not just the happy path
- Forms disable on submit and survive a double-click without creating two orders
- Images sized and lazy-loaded (`next/image`); a catalog of unoptimised photos is the usual reason a store feels slow
- Keyboard reachable, labelled inputs, visible focus, contrast that passes — the design studio especially
- Mobile checked at 360px, since most Bangladeshi traffic is mobile

### Maintainability
- No `any`
- Types shared through `packages/shared` rather than redeclared on both sides
- Behaviour covered by a test that would fail if the behaviour broke
- Dead code, stray `console.log`, and commented-out blocks removed
- One responsibility per file; a file that has grown past a few hundred lines is telling you something

---

## C. Phase-specific — check whichever applies

| Phase | Watch for |
|---|---|
| 02 Auth | refresh rotation, guard coverage, no hash in responses |
| 03 Catalog | price/stock authority server-side, unbounded queries |
| 04 Studio | upload validation, SVG sanitising, canvas JSON size cap |
| 05 3D | asset size, texture memory, mobile fallback |
| 06 Checkout | Order ID race, stock race, transaction boundaries |
| 07 Payments | webhook signature, idempotency, server-side totals |
| 08 Lifecycle | status transitions validated against the state machine |
| 09 Admin | ownership checks, activity log, staff-only routes |
| 10 Jobs | retry/backoff, dead letter, no PII in job payloads |
| 11 Reports | query cost, no full-table scans on every dashboard load |
| 12 Deploy | secrets rotated, rate limits, backups restored, HTTPS/HSTS |
