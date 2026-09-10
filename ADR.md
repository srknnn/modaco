# ADR-001 — Catalog ingest and flash-sale reads

**Status:** Accepted  
**Scope:** How this repo satisfies Scenario A (serverless vendor ingest) and Scenario B (category flash sale + hot storefront) without treating the API as plain CRUD.

---

## 1. Context

ModaCo needs a TypeScript / Express catalog API with two operational constraints that fight each other if designed naively.

**Scenario A — massive ingest, serverless consumption plan**

- Weekly vendor files are 500,000+ product/price rows.
- Each row must pass through **application-layer pricing rules** before Postgres (not a raw SQL copy).
- The ingest unit must fit Azure Functions / AWS Lambda consumption: short timeout, small memory, **the process dies when the HTTP request ends**. You cannot “return 202 and keep looping in the same process.”

**Scenario B — flash sale + hot reads**

- “50% off Accessories” must affect 50,000+ products immediately.
- `GET /products` (and especially `GET /products/:id`) takes massive read traffic.
- A product added to Accessories **while the sale is active** must get the discount.
- Writing 50k `effectivePrice` columns or 50k assignment rows at campaign start is the bottleneck the case is testing.

**Shared domain**

- Product: name, category, SKU, base price, stock.
- Promotion: percentage or fixed, validity window, target = one product **or** one category.
- At most one **resolved** active promotion per product when listing (SKU-level wins over category-level).
- Listings must expose `effectivePrice`, with filter / pagination / sort by that price.

---

## 2. Decision (one paragraph)

Promotions are **rules stored in Postgres**, not copies on each product. Ingest writes only `basePrice` after pricing rules. `effectivePrice` is computed on read. Storefront cache is optional speed, invalidated by a Redis **generation counter** (not by deleting 50k keys). Ingest is **accept file → 202 → split (files + ledger first) → enqueue N chunk jobs**; one worker function, N invocations. After three failed attempts a chunk goes to a **DLQ** (park, do not auto-replay). Replay is idempotent; there is no catalog-wide rollback.

Local vs AWS is an **adapter mapping**. The portable units are `processChunk(storageKey)` and the promotion/read path. We do not deploy Lambda in this repo.

---

## 3. What plays which AWS role

Redis is used for **two different jobs**. Mixing them up makes the design look like “ingest data lives in Redis.” It does not.

### 3.1 Object store (S3)

| | Local (this repo) | AWS |
|---|---|---|
| Role | Durable bytes for the vendor file and its slices | S3 bucket |
| Code | `src/storage/objectStorage.ts` (`put` / `get` / `stream`) | same interface, S3 client |
| Incoming file | `uploads/incoming/<jobId>/<filename>` | `s3://…/incoming/<jobId>/<filename>` |
| Slices | `uploads/chunks/<jobId>/0.csv`, `1.csv`, … | objects with the same key layout |

`uploads/` is gitignored. It is created at runtime. It is **not** the product catalog.

The splitter **streams** the incoming object (`storage.stream`) so a 500k-row file is not loaded as one string. Each flush writes a small chunk object so a worker only ever opens ~`CHUNK_SIZE` rows (default in `.env` is `5` for the sample file; production would be hundreds–thousands).

### 3.2 Queues (SQS)

| | Local | AWS |
|---|---|---|
| Role | Work tickets: “split this job”, “process this slice” | SQS (two queues) |
| Library | BullMQ on Redis | SQS + Lambda event source |
| Queue 1 | Redis list name `ingest-split` (`SPLIT_QUEUE`) | e.g. `modaco-ingest-split` |
| Queue 2 | Redis list name `ingest-chunks` (`CHUNK_QUEUE`) | e.g. `modaco-ingest-chunks` |
| DLQ | `ingest-split-dlq`, `ingest-chunks-dlq` | SQS redrive after 3 receives |
| Payload (split) | `{ jobId }` | same |
| Payload (chunk) | `{ jobId, chunkIndex, storageKey }` | same (`storageKey` is the S3 key) |

Defined in `src/lib/queue.ts`. Inspecting Redis, keys look like `bull:ingest-split:*` and `bull:ingest-chunks:*`. Those are **mail**, not products. After a chunk succeeds the ticket is gone; `Product` rows remain in Postgres.

**N workers does not mean N functions.** There is one chunk worker class in `src/worker.ts`. N = number of chunk messages = `ceil(rowCount / CHUNK_SIZE)`. Concurrency (`WORKER_CONCURRENCY`, default 5) is how many of those messages run at once.

### 3.3 Compute (Lambda)

| | Local | AWS |
|---|---|---|
| HTTP API | `npm run dev` → `src/server.ts` | API Gateway + a short Lambda **or** a small always-on API |
| Splitter | `npm run worker` listens on `ingest-split` | **one** Lambda triggered by the split queue |
| Chunk worker | same process, second listener on `ingest-chunks` | **one** Lambda triggered by the chunk queue, invoked N times |

Two OS processes locally so ingest survives after HTTP returns (consumption-plan rule).

### 3.4 Source of truth vs cache

| | Local | AWS |
|---|---|---|
| Catalog, promotions, ingest ledger | PostgreSQL (`Product`, `Category`, `Promotion`, `IngestJob`, `IngestChunk`) | RDS |
| Storefront cache + generation | Redis keys `category_gen:*`, `product:*:gN`, `list:*:gN` | ElastiCache |
| BullMQ | **also** Redis (see 3.2) | not used; SQS replaces it |

Postgres `IngestJob` / `IngestChunk` are the **ledger** (status, counts, errors). Redis queues are the **wakeup**. You can have a COMPLETED job in Postgres and empty BullMQ keys; that is success, not data loss.

---

## 4. Scenario A — end-to-end stages

Vendor file in this repo: `samples/vendor-small.csv` (20 rows). Production: 500k+ CSV on S3.

```text
CSV
 │
 ├─① POST /api/v1/ingest/jobs     Express (short)
 │     uploads/incoming/…          (S3)
 │     IngestJob PENDING           (Postgres)
 │     message → ingest-split      (SQS / BullMQ)
 │     HTTP 202                    process may die
 │
 ├─② Splitter worker              1 invocation
 │     stream CSV → chunk files + IngestChunk rows
 │     set totalChunks, status PROCESSING
 │     THEN enqueue PENDING slices → ingest-chunks
 │     maybeCompleteJob            (fast workers cannot finish at totalChunks=0)
 │
 └─③ Chunk worker                 N invocations of the SAME function
       read slice
       applyPricingRules           (margin, not promotions)
       upsert Product by SKU
       mark chunk COMPLETED
       3 failures → ingest-chunks-dlq (parked; no worker)
       replay-failed → main queue again
       processed+failed == total → job COMPLETED or FAILED
```

### Stage ① — Accept only (`src/routes/ingest.route.ts`, `src/services/ingest.service.ts`)

1. Client uploads a CSV (`multipart` field `file`).
2. Bytes go to object storage under `incoming/<jobId>/…`.
3. A Postgres `IngestJob` row is created (`PENDING`).
4. One message is pushed to **`ingest-split`**.
5. API returns **202** with the job id. It does not parse 500k rows.

If `npm run worker` is down, the job stays `PENDING` and the split message waits in Redis. That is the demonstration that HTTP must not do the work.

### Stage ② — Split (`src/ingest/splitter.ts`)

The split worker (`src/worker.ts` → `splitIngestJob`):

1. If this job already has PROCESSING/COMPLETED/FAILED chunks, **do not delete them** (a retry must not yank work from in-flight workers).
2. Otherwise stream the incoming object into chunk files + `IngestChunk` rows. **Do not enqueue yet.**
3. Set `totalChunks` and `PROCESSING` (or `COMPLETED` if the file was empty).
4. Enqueue only `PENDING` chunks. Then call `maybeCompleteJob` so a fast worker that already finished every slice cannot leave the job stuck with `totalChunks = 0`.

20 sample rows and `CHUNK_SIZE=5` → `0.csv` … `3.csv` and **4** chunk messages.

### Stage ③ — Process chunks (`src/ingest/handleChunkJob.ts`, `src/ingest/processChunk.ts`)

Each chunk message is one invocation:

1. Chunk status → `PROCESSING`.
2. `processChunk` reads **only that slice**, validates rows, upserts categories by slug, applies `PRICE_MARGIN` (10% → vendor `100` becomes `basePrice` `110.00`), `product.upsert` on `sku`.
3. Chunk `COMPLETED` only if the row was not already completed, then `processedChunks++` once. Transient failures stay `PROCESSING` and the queue retries (`attempts: 3`, exponential backoff). After the last attempt the message is copied to **`ingest-chunks-dlq`** (AWS: SQS redrive). `failedChunks++` happens **once**, when the chunk first becomes `FAILED`. Catalog rows from earlier chunks are not rolled back. Recovery: `POST /api/v1/ingest/jobs/:id/replay-failed` re-queues those slices; upsert-by-SKU and the COMPLETED short-circuit make replay safe.
4. When `processedChunks + failedChunks === totalChunks`, the job is `COMPLETED` or `FAILED`.

**Ingest does not write promotions.** If a category flash sale is already active, new SKUs pick it up on **read** (Scenario B), not in `processChunk`.

### What we refused for A

| Approach | Why it fails the constraint |
|---|---|
| One Lambda / one `for` over 500k rows | Timeout, memory |
| Load entire CSV into an array | Memory |
| `res.json(202)` then continue in the API process | Consumption plan freezes/kills the process |
| Excel `.xlsx` as the ingest format | Hard to stream; we take CSV |
| Apply flash-sale price during ingest | Couples A to B; 50k writes; new products would need ingest to “see” the sale |

---

## 5. Scenario B — end-to-end stages

Flash sale is **not** an ingest pipeline and **not** a Redis generation feature for “joining the campaign.” Generation only protects **cached** storefront JSON.

```text
POST /promotions                    1 row, untargeted
POST /promotions/:id/assign
  targetType=CATEGORY
  categoryId = Accessories          still 1 row
  INCR category_gen:{categoryId}    cache generation only

GET /products/:id  or  GET /products
  winner = product promo ?? category promo
  effectivePrice = apply(basePrice, winner)
  Redis lookup product:{id}:g{gen}  (optional cache)
```

### Stage ① — Create the rule (`POST /api/v1/promotions`)

Insert `Promotion`: name, `PERCENTAGE` | `FIXED`, value, `startAt` / `endAt`, `status=ACTIVE`. `targetType` may still be null. **No product prices change.**

### Stage ② — Point it at a category or SKU (`POST /api/v1/promotions/:id/assign`)

- `CATEGORY`: set `categoryId`, clear `productId`. Reject **409** if another active category promo overlaps on the same category.
- `PRODUCT`: set `productId`, clear `categoryId`. Reject **409** if another active SKU promo overlaps on that product.
- Then `INCR category_gen:{that category}` (`src/cache/generation.ts`).

Conflict policy: **SKU-level wins over category-level** at read time (`src/domain/effectivePrice.ts`). Two category promos or two SKU promos on the same target are forbidden. “At most one active promotion” means the **resolved winner**, not “a product cannot sit in a category that has a sale.”

Cancel (`POST …/cancel`) sets `CANCELLED` and bumps the same generation.

### Stage ③ — Storefront read (the hot path)

`GET /api/v1/products/:id` (SKU or uuid) and `GET /api/v1/products?category=&page=&limit=&sort=effectivePrice|-effectivePrice`:

1. Load product(s) from Postgres (`basePrice` is the shelf tag).
2. Load **currently** in-window promotions (`activePromotionWhere()` uses `new Date()` **per request**, not at process start).
3. `effectivePrice(base, productPromo, categoryPromo)`.
4. Optionally cache (next section).

A **new** product `POST /api/v1/products` into Accessories does not get a promotion row. The first GET computes the category rule. Generation is irrelevant until something was cached under the old number.

Listing sort: a uniform category % or fixed discount is monotonic, so `ORDER BY basePrice` (index `(categoryId, basePrice)`) matches `effectivePrice` order. Mixed SKU overrides can change order inside a page; we accept that rather than UPDATE 50k prices.

### Stage ④ — Cache generation (read-load only)

This is **not** how products join a sale.

Without cache, every flash-sale GET hits Postgres. The case’s hottest endpoint makes a short TTL cache reasonable. Cached JSON includes `effectivePrice`. If we cached “BAG-001 = 110” and then assigned 50% off, we would keep serving 110 until TTL unless we invalidate.

Invalidating 50k `product:*` keys is another write storm. Instead:

| Redis key | TTL | Meaning |
|---|---|---|
| `category_gen:{categoryId}` | none (`INCR` only) | Current storefront generation (e.g. `2`) |
| `product:{productId}:g2` | 60s | Cached product JSON for generation 2 |
| `list:{categoryId}:{sort}:{page}:{limit}:g2` | 45s | Cached list page |

Read path (`src/cache/store.ts`):

1. `GET category_gen:{categoryId}` → `2` (missing → `0`).
2. Build `product:{id}:g2` (not an HTTP path; a Redis key).
3. Hit → return. Miss → compute, `SET … EX 60`.
4. If Redis throws, skip cache and serve from Postgres (ingest still needs Redis for BullMQ).

After assign, `INCR` → `3`. The next GET asks for `g3`. Key `g2` may still exist; **nobody reads it**. There is no `/v3` URL.

`category_gen` has no TTL; it is a counter. TTL is on the JSON blobs. Those blobs appear **only after a GET**. Assign-only leaves just the counter in Redis.

### What we refused for B

| Approach | Why it fails |
|---|---|
| `UPDATE products SET effective_price=…` for 50k rows | Write storm, locks, fights ingest |
| 50k `Promotion` / assignment rows | Same amplification; new SKUs would need a write |
| Cache without generation, only TTL | Flash sale delayed by up to 60s |
| `DEL` every `product:*` in the category | 50k Redis deletes |
| Elasticsearch / extra read-model table of prices | Hidden 50k projection; overkill for the take-home |

---

## 6. How A and B meet

| Event | Ingest (A) | Flash sale (B) |
|---|---|---|
| Weekly CSV | Chunk upsert `basePrice` | Unchanged |
| Sale already on Accessories | New accessory SKUs stored at tag price | First GET applies % off |
| Sale starts during catalog traffic | Chunks still only upsert products | 1 promotion row + `INCR` |
| Hot `GET /products/:id` | Not on this path | Compute + `product:…:gN` |

Pricing rules (A) and promotions (B) are different layers. Conflating them is the usual AI mistake this design avoids.

---

## 7. Trade-offs

- **No catalog-wide rollback.** A dead chunk is parked on the DLQ after 3 attempts. Earlier upserts stay. `POST /api/v1/ingest/jobs/:id/replay-failed` re-queues FAILED slices. The DLQ has no worker; it does not run on insert.
- **Cache fail-open.** Redis errors on `GET /products` skip the cache and hit Postgres; ingest still needs Redis for BullMQ.
- **BullMQ ≠ SQS.** Same job shapes; Redis is a stand-in. Production would swap the queue adapter, keep `processChunk`.
- **Generation vs TTL.** `INCR` makes the next key miss immediately. Without a bump, a blob can stay wrong until 45–60s expire.
- **List sort.** Exact for one uniform category discount; approximate across mixed SKU overrides after `basePrice` pagination.
- **Local two-process model** maps consumption-plan freeze; it is not a deployed Lambda/SAM stack.
- **CSV only.** Matches stream + memory limits; vendors sending `.xlsx` would convert before S3.

---

## 8. How to see the stages

Prereq: `docker compose up -d`, migrations, `npm run dev`, `npm run worker`.

**A:** `POST /api/v1/ingest/jobs` with `samples/vendor-small.csv` → poll `GET /api/v1/ingest/jobs/:id` until `totalChunks: 4` and `COMPLETED`. Disk: `uploads/chunks/<id>/0.csv`…`3.csv`. `BAG-001` `basePrice` is `110` (CSV price `100` + 10% margin). A chunk that fails three times is `FAILED` + `dlqAt`; replay with `POST /api/v1/ingest/jobs/:id/replay-failed` (does not undo SKUs from successful chunks).

**B:** `GET /api/v1/products/BAG-001` (creates `product:<uuid>:gN`). Assign Accessories 50% → `category_gen` increments; next GET uses `gN+1` and `effectivePrice` `55`. `POST /api/v1/products` into Accessories with the sale on → `effectivePrice` already discounted; no extra ingest and no generation required for that new SKU.
