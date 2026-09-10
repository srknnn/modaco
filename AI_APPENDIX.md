# Form 5 — AI Appendix

Mandatory case-study attachment. Written from the actual Cursor collaboration on this repo (architecture discussion first, then implementation).

---

## 1. Tool Manifest

| Model / Tool | Primary Purpose of Use | Effectiveness (1–5) & brief why |
|---|---|---|
| Cursor (Grok 4.6), Ask mode | Joint architecture for Scenarios A and B: constraints, rejected designs, local-vs-AWS mapping, cache generation vs promotion-as-rule | **4** — Mapped the two scenarios together well once constrained. First explanations were too dense; needed several “explain this simply” loops (N Lambdas, generation keys, Redis roles). |
| Cursor (Grok 4.6), Agent mode | Scaffold Express/Prisma/BullMQ, ingest splitter/chunk workers, promotions API, Redis cache, tests, `ADR.md` rewrite | **4** — Produced a runnable local stand-in for S3/SQS/Lambda. Missed runtime details (BullMQ job ids cannot contain `:`, port clashes with other local Docker). Human had to run, observe, and send it back. |
| Cursor Grok 4.6 (same chat) | Fill this appendix and keep `ADR.md` aligned with the real code | **4** — Useful as a log of *this* conversation; I still rewrote claims so they match what we actually built, not a generic “AI helped me code” paragraph. |

No ChatGPT, Copilot, Gemini, or image tools were used for the submission.

---

## 2. AI Tool Usage Approach

Do not paste raw transcripts. Strategy: lock decisions in Ask mode **before** Agent mode wrote files. I treated the model as a design partner that must be argued with, not as an oracle.

| Phase / specific task | Prompting strategy & context provided | Human refinement (how I edited or iterated) |
|---|---|---|
| **Critical prompt 1 — joint A+B architecture.** Asked to evaluate both scenarios together against the serverless timeout/memory/stateless HTTP rule and the flash-sale 50k-product / hot `GET /products` rule, and to produce one architecture, not two disconnected CRUD extras. | Pasted / attached the case PDF. Forbade “just REST + one Lambda.” Asked for trade-offs and what to reject. | I did **not** accept the first jargon-heavy answer. Follow-ups: explain cache simply; where is generation stored; is it a URL; N Lambdas vs one function; local test without an S3 account. Locked: promotions as rules, compute `effectivePrice` on read, SKU wins over category, ingest writes only `basePrice`, local disk + BullMQ as S3/SQS. |
| **Critical prompt 2 — local AWS stand-in.** “We will say S3 and Lambda exist; how do I test without an AWS account? One Lambda with a for-loop, or N Lambdas? How do I create N if I don’t know N?” | Explicit AWS (not Azure). Constraint: two functions max, N = message count. | Corrected the mental model: **one** worker function, N queue messages. Rejected LocalStack as too heavy. Chose `uploads/` + BullMQ + a second Node process so HTTP can return `202` and die. Set `CHUNK_SIZE=5` on the 20-row sample so four chunks are visible. |
| Implementation | “Build under `modaco/`, local first.” Pointed at the agreed stack (Express, TS, Prisma, Postgres, Redis, BullMQ). | I ran health/ingest/promotion curls, Prisma Studio, Redis. Agent mode then fixed splitter retry (unique chunk rows) and BullMQ `jobId` (`:` forbidden). I asked for a stronger `ADR.md` after the first short version. Ports became 3001 / 5434 / 6380 to avoid another project’s Docker. |
| Form 5 / ADR | Asked to fill this form from the real chat, not a template. | Trimmed anything that claimed I typed the TypeScript by hand. Kept the mistakes I actually caught. |

---

## 3. Judgement, Challenges & Verification

| Challenge (incl. AI defaults / hallucinations) | Judgement / verification | Resolution |
|---|---|---|
| Generic ingest answer: **one** consumption-plan function that chunks in a `for` loop, or “continue after `202` in the same HTTP process.” | Read the case: timeout, memory, process dies when HTTP ends. A loop in one invocation still dies mid-file. | Split into accept → split queue → chunk queue. One splitter function, one worker function, N invocations. Documented in `ADR.md` §4. |
| Generic flash-sale answer: `UPDATE` 50k `effectivePrice` values or 50k assignment rows; or apply the sale inside ingest. | That fights Scenario A (lock/contention) and breaks “new product in the category must get the discount” unless ingest re-reads promotions. | Promotion is a Postgres rule (`targetType` + `categoryId` / `productId`). Reads compute `effectivePrice`. Ingest never writes promotions. |
| I initially read **generation** as “how a new SKU joins the sale.” | Traced `bumpCategoryGeneration` vs `effectivePrice()`. New products have no cache key; the category FK is enough. | Kept generation **only** as cheap cache invalidation (`INCR category_gen`, next GET uses `product:{id}:g{n}`). Confirmed in Redis: counter exists after assign; `product:…:gN` appears only after GET. |
| Agent wrote BullMQ `jobId` as `{uuid}:{index}`. Splitter failed: “Custom Id cannot contain `:`.” Retry then hit unique `(jobId, chunkIndex)`. | Worker logs + `GET /ingest/jobs/:id` stuck in `SPLITTING`. | Job ids `{uuid}-chunk-{index}`. Split deletes existing chunks before re-stream. Re-ingest: 4/4 `COMPLETED`. |
| First `ADR.md` was a mapping table without a stage-by-stage A/B story. Redis queue keys vs cache keys were easy to confuse. | Read `queue.ts` vs `cache/generation.ts` while watching Redis. | Rewrote `ADR.md`: S3 vs SQS vs Lambda vs RDS vs ElastiCache, A stages ①–③, B stages ①–④, what we refused. |

---

## 4. Overall Reflection

**Estimated ratio:** about **60% AI-generated / 40% human-crafted or heavily steered.**

- Almost all TypeScript, Prisma schema, Docker Compose, and the first ADR draft came from Agent mode.
- Architecture *choices*, the local-vs-AWS story, rejection of 50k writes and single-Lambda ingest, generation-as-cache-only, demo chunk size, runtime bugfixes, and the ADR rewrite were human-directed through Ask-mode interrogation and by running the system.

This is not “I pair-typed every line.” It is “I would not submit the model’s first architecture.”

**Key takeaway:** For this case the blind spot is not syntax; it is **constraint respect**. Unprompted, the tool reaches for one big job, denormalized prices, or extra boxes (LocalStack, search indexes). It also overloaded Redis in the explanation (BullMQ tickets vs `category_gen` vs cached JSON) until I forced a split. Using AI **did** change the original approach: I started from “how do I CRUD promotions?” and ended on “rules on read + chunked ingest with two functions.” That shift only stuck because I kept asking where HTTP ends, who creates N, and whether generation is required for a new product. In the interview I can walk those three questions without the model in the room.

---

## Mapping to the PDF’s three bullets

The Invent.ai PDF also asked:

1. **Tools:** Cursor + Grok 4.6 only (table in §1).
2. **Two most critical prompts:** joint A+B architecture; local AWS stand-in without N deployed Lambdas (§2).
3. **Biggest AI architectural mistake I refused:** one-shot / in-process 500k ingest on a consumption plan, and materializing a flash sale onto 50k rows (§3, first two rows).
