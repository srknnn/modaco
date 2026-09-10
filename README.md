# ModaCo Promotion Management API

Internal catalog and promotion API. Vendor files are ingested in chunks; storefront reads compute `effectivePrice`. Redis cache is optional on reads (fails open to Postgres).

Local stand-ins (no AWS account):

| AWS | This repo |
|---|---|
| S3 | `uploads/` (`src/storage/objectStorage.ts`) |
| SQS | Redis + BullMQ (`ingest-split`, `ingest-chunks`) |
| SQS redrive / DLQ | `ingest-split-dlq`, `ingest-chunks-dlq` — **parked**; no worker until you replay |
| Splitter / chunk Lambdas | `npm run worker` — **one** chunk function, N queue messages |

See [ADR.md](ADR.md) for Scenario A/B. Case Form 5: [AI_APPENDIX.md](AI_APPENDIX.md).

## Run

```bash
cp .env.example .env
docker compose up -d   # Postgres :5434, Redis :6380
npm install
npx prisma migrate dev
npm run prisma:seed
```

Two terminals (HTTP must not do ingest — consumption-plan rule):

```bash
npm run dev      # API  http://localhost:3001
npm run worker   # splitter + chunk workers
```

`GET /health` → `{ "ok": true }`.

### Scenario A — ingest

`CHUNK_SIZE=5` so `samples/vendor-small.csv` (20 rows) becomes **4** chunk jobs.

```bash
curl -s -X POST http://localhost:3001/api/v1/ingest/jobs \
  -F "file=@samples/vendor-small.csv"
```

Poll `GET /api/v1/ingest/jobs/:id` until `COMPLETED`. Vendor `price` 100 is stored as `basePrice` **110** (`PRICE_MARGIN=0.10`).

Split writes slice files **first**, sets `totalChunks`, **then** enqueues. After **3** failed attempts a chunk is copied to `ingest-chunks-dlq` and marked `FAILED` (`dlqAt`). Nothing consumes the DLQ by itself. Replay (idempotent upsert; does not roll back other chunks):

```bash
curl -s -X POST http://localhost:3001/api/v1/ingest/jobs/<id>/replay-failed
```

```bash
curl -s "http://localhost:3001/api/v1/products?category=accessories&sort=effectivePrice"
```

### Scenario B — flash sale

One promotion row, not 50k product updates. Cache generation is **not** how a new SKU joins the sale.

```bash
curl -s -X POST http://localhost:3001/api/v1/promotions \
  -H 'Content-Type: application/json' \
  -d '{"name":"Accessories 50%","discountType":"PERCENTAGE","value":50,"startAt":"2026-01-01T00:00:00.000Z","endAt":"2027-01-01T00:00:00.000Z"}'

curl -s -X POST http://localhost:3001/api/v1/promotions/<id>/assign \
  -H 'Content-Type: application/json' \
  -d '{"targetType":"CATEGORY","category":"accessories"}'
```

`GET /api/v1/products/BAG-001` → `effectivePrice` 55, `basePrice` still 110. A product `POST`ed into Accessories while the sale is on is discounted on the first GET. SKU promo wins over category; two overlapping product (or two category) promos → `409`.

```bash
npm test
```
