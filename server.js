import express from "express"
import cors from "cors"
import dotenv from "dotenv"
import productRoutes from "./routes/product.routes.js"
import categoryRoutes from "./routes/category.routes.js"
import authRoutes from "./routes/auth.routes.js"
import cartRoutes from "./routes/cart.routes.js"
import orderRoutes from "./routes/order.routes.js"
import promotionRoutes from "./routes/promotion.routes.js"
import wishlistRoutes from "./routes/wishlist.routes.js"
import { errorHandler } from "./middleware/error.middleware.js"

dotenv.config()

const app = express()
const PORT = process.env.PORT || 5000

// Middleware
app.use(cors())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// Routes
app.use("/api/products", productRoutes)
app.use("/api/categories", categoryRoutes)
app.use("/api/auth", authRoutes)
app.use("/api/cart", cartRoutes)
app.use("/api/orders", orderRoutes)
app.use("/api/promotions", promotionRoutes)
app.use("/api/wishlist", wishlistRoutes)

// Root route
app.get("/", (req, res) => {
  res.json({ message: "Welcome to E-Commerce API" })
})

// Error handling middleware
app.use(errorHandler)

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`)
})

export default app
