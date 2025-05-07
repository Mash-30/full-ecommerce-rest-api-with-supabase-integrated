import supabase from "../utils/supabase.js"
import { ApiError } from "../utils/api-error.js"
import { ApiResponse } from "../utils/api-response.js"

// Get user's wishlist
export const getWishlist = async (req, res, next) => {
  try {
    // Find or create wishlist
    let { data: wishlist, error: wishlistError } = await supabase
      .from("wishlists")
      .select("*")
      .eq("user_id", req.user.id)
      .single()

    if (wishlistError && wishlistError.code !== "PGRST116") {
      // PGRST116 is "no rows returned" error
      throw new ApiError(500, "Error retrieving wishlist", wishlistError.message)
    }

    if (!wishlist) {
      // Create new wishlist
      const { data: newWishlist, error: createError } = await supabase
        .from("wishlists")
        .insert({ user_id: req.user.id })
        .select()
        .single()

      if (createError) {
        throw new ApiError(500, "Error creating wishlist", createError.message)
      }

      wishlist = newWishlist
    }

    // Get wishlist items with product details
    const { data: items, error: itemsError } = await supabase
      .from("wishlist_items")
      .select(`
        id,
        added_at,
        product:product_id(id, name, price, images, stock, status)
      `)
      .eq("wishlist_id", wishlist.id)
      .order("added_at", { ascending: false })

    if (itemsError) {
      throw new ApiError(500, "Error retrieving wishlist items", itemsError.message)
    }

    // Filter out any products that are no longer active
    const activeItems = items.filter((item) => item.product && item.product.status === "active")

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          id: wishlist.id,
          items: activeItems || [],
        },
        "Wishlist retrieved successfully",
      ),
    )
  } catch (error) {
    next(error)
  }
}

// Add item to wishlist
export const addToWishlist = async (req, res, next) => {
  try {
    const { productId } = req.body

    // Validate product
    const { data: product, error: productError } = await supabase
      .from("products")
      .select("*")
      .eq("id", productId)
      .single()

    if (productError) {
      throw new ApiError(404, "Product not found")
    }

    // Find or create wishlist
    let { data: wishlist, error: wishlistError } = await supabase
      .from("wishlists")
      .select("*")
      .eq("user_id", req.user.id)
      .single()

    if (wishlistError && wishlistError.code !== "PGRST116") {
      throw new ApiError(500, "Error retrieving wishlist", wishlistError.message)
    }

    if (!wishlist) {
      // Create new wishlist
      const { data: newWishlist, error: createError } = await supabase
        .from("wishlists")
        .insert({ user_id: req.user.id })
        .select()
        .single()

      if (createError) {
        throw new ApiError(500, "Error creating wishlist", createError.message)
      }

      wishlist = newWishlist
    }

    // Check if product already in wishlist
    const { data: existingItem, error: checkError } = await supabase
      .from("wishlist_items")
      .select("*")
      .eq("wishlist_id", wishlist.id)
      .eq("product_id", productId)
      .single()

    if (!checkError && existingItem) {
      return res.status(200).json(new ApiResponse(200, existingItem, "Product already in wishlist"))
    }

    // Add product to wishlist
    const { data: item, error: addError } = await supabase
      .from("wishlist_items")
      .insert({
        wishlist_id: wishlist.id,
        product_id: productId,
      })
      .select()
      .single()

    if (addError) {
      throw new ApiError(500, "Error adding product to wishlist", addError.message)
    }

    return res.status(201).json(new ApiResponse(201, item, "Product added to wishlist successfully"))
  } catch (error) {
    next(error)
  }
}

// Remove item from wishlist
export const removeFromWishlist = async (req, res, next) => {
  try {
    const { itemId } = req.params

    // Find wishlist
    const { data: wishlist, error: wishlistError } = await supabase
      .from("wishlists")
      .select("*")
      .eq("user_id", req.user.id)
      .single()

    if (wishlistError) {
      throw new ApiError(404, "Wishlist not found")
    }

    // Remove item from wishlist
    const { error: removeError } = await supabase
      .from("wishlist_items")
      .delete()
      .eq("id", itemId)
      .eq("wishlist_id", wishlist.id)

    if (removeError) {
      throw new ApiError(500, "Error removing product from wishlist", removeError.message)
    }

    return res.status(200).json(new ApiResponse(200, null, "Product removed from wishlist successfully"))
  } catch (error) {
    next(error)
  }
}

// Clear wishlist
export const clearWishlist = async (req, res, next) => {
  try {
    // Find wishlist
    const { data: wishlist, error: wishlistError } = await supabase
      .from("wishlists")
      .select("*")
      .eq("user_id", req.user.id)
      .single()

    if (wishlistError) {
      throw new ApiError(404, "Wishlist not found")
    }

    // Remove all items from wishlist
    const { error: clearError } = await supabase.from("wishlist_items").delete().eq("wishlist_id", wishlist.id)

    if (clearError) {
      throw new ApiError(500, "Error clearing wishlist", clearError.message)
    }

    return res.status(200).json(new ApiResponse(200, null, "Wishlist cleared successfully"))
  } catch (error) {
    next(error)
  }
}
