import supabase from "../utils/supabase.js"
import { ApiError } from "../utils/api-error.js"
import { ApiResponse } from "../utils/api-response.js"

// Get all products with pagination and filtering
export const getProducts = async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 10,
      sort = "created_at",
      order = "desc",
      category,
      minPrice,
      maxPrice,
      search,
      featured,
      status = "active",
    } = req.query

    // Start building the query
    let query = supabase.from("products").select("*, categories!inner(*)", { count: "exact" }).eq("status", status)

    // Apply filters
    if (category) {
      query = query.eq("category_id", category)
    }

    if (minPrice) {
      query = query.gte("price", minPrice)
    }

    if (maxPrice) {
      query = query.lte("price", maxPrice)
    }

    if (featured === "true") {
      query = query.eq("featured", true)
    }

    if (search) {
      query = query.textSearch("search_vector", search)
    }

    // Apply pagination
    const from = (page - 1) * limit
    const to = from + limit - 1

    // Apply sorting
    query = query.order(sort, { ascending: order === "asc" })

    // Execute the query with pagination
    const { data: products, count, error } = await query.range(from, to)

    if (error) {
      throw new ApiError(500, "Error retrieving products", error.message)
    }

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          products,
          pagination: {
            total: count,
            page: Number(page),
            limit: Number(limit),
            pages: Math.ceil(count / Number(limit)),
          },
        },
        "Products retrieved successfully",
      ),
    )
  } catch (error) {
    next(error)
  }
}

// Get product by ID
export const getProductById = async (req, res, next) => {
  try {
    const { id } = req.params

    const { data: product, error } = await supabase
      .from("products")
      .select(`
        *,
        categories:category_id(*),
        subcategories:subcategory_id(*),
        variants:product_variants(*)
      `)
      .eq("id", id)
      .single()

    if (error) {
      throw new ApiError(404, "Product not found")
    }

    return res.status(200).json(new ApiResponse(200, product, "Product retrieved successfully"))
  } catch (error) {
    next(error)
  }
}

// Create new product
export const createProduct = async (req, res, next) => {
  try {
    const productData = req.body

    const { data: product, error } = await supabase.from("products").insert(productData).select().single()

    if (error) {
      throw new ApiError(400, "Error creating product", error.message)
    }

    // If there are variants, insert them
    if (productData.variants && productData.variants.length > 0) {
      const variants = productData.variants.map((variant) => ({
        ...variant,
        product_id: product.id,
      }))

      const { error: variantError } = await supabase.from("product_variants").insert(variants)

      if (variantError) {
        throw new ApiError(400, "Error creating product variants", variantError.message)
      }
    }

    return res.status(201).json(new ApiResponse(201, product, "Product created successfully"))
  } catch (error) {
    next(error)
  }
}

// Update product
export const updateProduct = async (req, res, next) => {
  try {
    const { id } = req.params
    const productData = req.body

    // Update the product
    const { data: product, error } = await supabase.from("products").update(productData).eq("id", id).select().single()

    if (error) {
      throw new ApiError(400, "Error updating product", error.message)
    }

    // If there are variants, handle them
    if (productData.variants && productData.variants.length > 0) {
      // First, delete existing variants
      const { error: deleteError } = await supabase.from("product_variants").delete().eq("product_id", id)

      if (deleteError) {
        throw new ApiError(400, "Error updating product variants", deleteError.message)
      }

      // Then, insert new variants
      const variants = productData.variants.map((variant) => ({
        ...variant,
        product_id: id,
      }))

      const { error: variantError } = await supabase.from("product_variants").insert(variants)

      if (variantError) {
        throw new ApiError(400, "Error updating product variants", variantError.message)
      }
    }

    return res.status(200).json(new ApiResponse(200, product, "Product updated successfully"))
  } catch (error) {
    next(error)
  }
}

// Delete product
export const deleteProduct = async (req, res, next) => {
  try {
    const { id } = req.params

    // Delete the product (variants will be deleted via cascade)
    const { error } = await supabase.from("products").delete().eq("id", id)

    if (error) {
      throw new ApiError(400, "Error deleting product", error.message)
    }

    return res.status(200).json(new ApiResponse(200, null, "Product deleted successfully"))
  } catch (error) {
    next(error)
  }
}

// Search products
export const searchProducts = async (req, res, next) => {
  try {
    const { q, limit = 10 } = req.query

    if (!q) {
      throw new ApiError(400, "Search query is required")
    }

    const { data: products, error } = await supabase
      .from("products")
      .select("id, name, price, images, category_id")
      .textSearch("search_vector", q)
      .eq("status", "active")
      .limit(Number(limit))

    if (error) {
      throw new ApiError(500, "Error searching products", error.message)
    }

    return res.status(200).json(new ApiResponse(200, products, "Search results retrieved successfully"))
  } catch (error) {
    next(error)
  }
}

// Get related products
export const getRelatedProducts = async (req, res, next) => {
  try {
    const { id } = req.params

    // First, get the product to find its category
    const { data: product, error: productError } = await supabase
      .from("products")
      .select("category_id")
      .eq("id", id)
      .single()

    if (productError) {
      throw new ApiError(404, "Product not found")
    }

    // Then, get related products from the same category
    const { data: relatedProducts, error } = await supabase
      .from("products")
      .select("id, name, price, images")
      .eq("category_id", product.category_id)
      .eq("status", "active")
      .neq("id", id)
      .limit(4)

    if (error) {
      throw new ApiError(500, "Error retrieving related products", error.message)
    }

    return res.status(200).json(new ApiResponse(200, relatedProducts, "Related products retrieved successfully"))
  } catch (error) {
    next(error)
  }
}
