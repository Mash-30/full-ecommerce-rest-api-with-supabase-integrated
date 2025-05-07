import express from "express"
import {
  getCategories,
  getCategoryById,
  createCategory,
  updateCategory,
  deleteCategory,
} from "../controllers/category.controller.js"
import { authenticate, authorize } from "../middleware/auth.middleware.js"

const router = express.Router()

// Public routes
router.get("/", getCategories)
router.get("/:id", getCategoryById)

// Admin routes
router.post("/", authenticate, authorize("admin"), createCategory)
router.put("/:id", authenticate, authorize("admin"), updateCategory)
router.delete("/:id", authenticate, authorize("admin"), deleteCategory)

export default router
