import { Router } from "express";
import { createProductSchema, listProductsQuerySchema } from "../dto/product.dto.js";
import { createProduct, getProduct, listProducts } from "../services/product.service.js";

export const productsRouter = Router();

productsRouter.get("/", async (req, res, next) => {
  try {
    res.json(await listProducts(listProductsQuerySchema.parse(req.query)));
  } catch (error) {
    next(error);
  }
});

productsRouter.get("/:id", async (req, res, next) => {
  try {
    res.json(await getProduct(req.params.id));
  } catch (error) {
    next(error);
  }
});

productsRouter.post("/", async (req, res, next) => {
  try {
    res.status(201).json(await createProduct(createProductSchema.parse(req.body)));
  } catch (error) {
    next(error);
  }
});
