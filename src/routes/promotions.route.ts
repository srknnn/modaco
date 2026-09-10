import { Router } from "express";
import { assignPromotionSchema, createPromotionSchema } from "../dto/promotion.dto.js";
import {
  assignPromotion,
  cancelPromotion,
  createPromotion,
  listPromotions,
} from "../services/promotion.service.js";

export const promotionsRouter = Router();

promotionsRouter.get("/", async (_req, res, next) => {
  try {
    res.json(await listPromotions());
  } catch (error) {
    next(error);
  }
});

promotionsRouter.post("/", async (req, res, next) => {
  try {
    res.status(201).json(await createPromotion(createPromotionSchema.parse(req.body)));
  } catch (error) {
    next(error);
  }
});

promotionsRouter.post("/:id/assign", async (req, res, next) => {
  try {
    res.json(await assignPromotion(req.params.id, assignPromotionSchema.parse(req.body)));
  } catch (error) {
    next(error);
  }
});

promotionsRouter.post("/:id/cancel", async (req, res, next) => {
  try {
    res.json(await cancelPromotion(req.params.id));
  } catch (error) {
    next(error);
  }
});
