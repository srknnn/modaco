import express from "express";
import { errorHandler } from "./middleware/errorHandler.js";
import { ingestRouter } from "./routes/ingest.route.js";
import { productsRouter } from "./routes/products.route.js";
import { promotionsRouter } from "./routes/promotions.route.js";

export function createApp() {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.use("/api/v1/products", productsRouter);
  app.use("/api/v1/promotions", promotionsRouter);
  app.use("/api/v1/ingest", ingestRouter);

  app.use(errorHandler);
  return app;
}
