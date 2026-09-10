# ModaCo Promotion Management API

Internal catalog and promotion API. Vendor files are ingested in chunks; storefront reads compute `effectivePrice` and cache with a category generation counter.

## Local run (no AWS account)

Local stand-ins:

| AWS | This repo |
|---|---|
| S3 | `uploads/` folder |
| SQS | Redis + BullMQ |
| Splitter / worker Lambdas | `npm run worker` (one splitter queue, one chunk queue; the chunk worker runs N times) |

```bash
docker compose up -d   # Postgres :5434, Redis :6380 (avoids local Maestro ports)
npm install
npx prisma migrate dev --name init
npm run prisma:seed
```

Two terminals:

```bash
npm run dev      # API  http://localhost:3001
npm run worker   # ingest splitter + chunk workers
```

### Ingest a vendor CSV

`CHUNK_SIZE=5` so the 20-row sample becomes 4 chunk jobs (same worker code, 4 invocations):

```bash
curl -s -X POST http://localhost:3001/api/v1/ingest/jobs \
  -F "file=@samples/vendor-small.csv"
```

Poll `GET /api/v1/ingest/jobs/:id` until `COMPLETED`. If a chunk dies after 3 attempts it lands on `ingest-chunks-dlq` (`FAILED` + `dlqAt` on the chunk). Replay without rolling back earlier SKUs:

```bash
curl -s -X POST http://localhost:3001/api/v1/ingest/jobs/<id>/replay-failed
```

List products:

```bash
curl -s "http://localhost:3001/api/v1/products?category=accessories&sort=effectivePrice"
```

Vendor `price` is not stored as-is: ingest applies a 10% margin (`PRICE_MARGIN`) first.

### Flash sale (category rule, not 50k row updates)

```bash
# create
curl -s -X POST http://localhost:3001/api/v1/promotions \
  -H 'Content-Type: application/json' \
  -d '{"name":"Accessories 50%","discountType":"PERCENTAGE","value":50,"startAt":"2026-01-01T00:00:00.000Z","endAt":"2027-01-01T00:00:00.000Z"}'

# assign to category (bumps Redis category_gen — cache keys change, no mass delete)
curl -s -X POST http://localhost:3001/api/v1/promotions/<id>/assign \
  -H 'Content-Type: application/json' \
  -d '{"targetType":"CATEGORY","category":"accessories"}'
```

A product created in that category while the sale is active gets the discount on read. Product-level promotions win over category ones. Two overlapping product (or two category) promos → `409`.

```bash
npm test
```

See [ADR.md](ADR.md) for the A/B design.
