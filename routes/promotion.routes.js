import express from "express"
import {
  getPromotions,
  getPromotionById,
  createPromotion,
  updatePromotion,
  deletePromotion,
  applyCoupon,
  removeCoupon,
} from "../controllers/promotion.controller.js"
import { authenticate, authorize, optionalAuth } from "../middleware/auth.middleware.js"

const router = express.Router()

// Admin routes
router.get("/", authenticate, authorize("admin"), getPromotions)
router.get("/:id", authenticate, authorize("admin"), getPromotionById)
router.post("/", authenticate, authorize("admin"), createPromotion)
router.put("/:id", authenticate, authorize("admin"), updatePromotion)
router.delete("/:id", authenticate, authorize("admin"), deletePromotion)

// Public routes (with optional auth)
router.post("/apply", optionalAuth, applyCoupon)
router.delete("/coupons/:couponId", optionalAuth, removeCoupon)

export default router
