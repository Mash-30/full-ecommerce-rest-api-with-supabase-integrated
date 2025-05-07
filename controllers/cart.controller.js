import supabase from "../utils/supabase.js"
import { ApiError } from "../utils/api-error.js"
import { ApiResponse } from "../utils/api-response.js"

// Helper function to recalculate cart totals
const recalculateCartTotals = async (cartId) => {
  // Get all active items in the cart (not saved for later)
  const { data: items, error } = await supabase
    .from("cart_items")
    .select("*")
    .eq("cart_id", cartId)
    .eq("saved_for_later", false)

  if (error) {
    throw new Error(`Error retrieving cart items: ${error.message}`)
  }

  // Calculate subtotal
  const subtotal = items.reduce((total, item) => total + item.price * item.quantity, 0)

  // For now, we'll set other totals to 0 or calculate them simply
  // In a real app, you'd calculate tax based on location, shipping based on weight/distance, etc.
  const taxTotal = subtotal * 0.1 // 10% tax for example
  const shippingTotal = subtotal > 100 ? 0 : 10 // Free shipping over $100
  const discountTotal = 0 // No discounts for now
  const grandTotal = subtotal + taxTotal + shippingTotal - discountTotal

  // Update the cart with the new totals
  const { error: updateError } = await supabase
    .from("carts")
    .update({
      subtotal,
      tax_total: taxTotal,
      shipping_total: shippingTotal,
      discount_total: discountTotal,
      grand_total: grandTotal,
    })
    .eq("id", cartId)

  if (updateError) {
    throw new Error(`Error updating cart totals: ${updateError.message}`)
  }

  return {
    subtotal,
    tax_total: taxTotal,
    shipping_total: shippingTotal,
    discount_total: discountTotal,
    grand_total: grandTotal,
  }
}

// Get cart
export const getCart = async (req, res, next) => {
  try {
    let cart
    const query = {}

    if (req.user) {
      // Logged in user
      query.user_id = req.user.id
    } else if (req.body.sessionId) {
      // Guest user with session ID
      query.session_id = req.body.sessionId
    } else {
      throw new ApiError(400, "Session ID is required for guest cart")
    }

    // Find cart
    const { data: cartData, error: cartError } = await supabase.from("carts").select("*").match(query).single()

    if (cartError && cartError.code !== "PGRST116") {
      // PGRST116 is "no rows returned" error
      throw new ApiError(500, "Error retrieving cart", cartError.message)
    }

    if (!cartData) {
      return res.status(200).json(new ApiResponse(200, { items: [], subtotal: 0, grand_total: 0 }, "Cart is empty"))
    }

    // Get cart items
    const { data: items, error: itemsError } = await supabase
      .from("cart_items")
      .select(`
        *,
        product:product_id(id, name, price, images, stock),
        variant:variant_id(id, size, color, price, stock)
      `)
      .eq("cart_id", cartData.id)

    if (itemsError) {
      throw new ApiError(500, "Error retrieving cart items", itemsError.message)
    }

    cart = {
      ...cartData,
      items: items || [],
    }

    return res.status(200).json(new ApiResponse(200, cart, "Cart retrieved successfully"))
  } catch (error) {
    next(error)
  }
}

// Add item to cart
export const addToCart = async (req, res, next) => {
  try {
    const { productId, variantId, quantity, sessionId } = req.body

    // Validate product
    const { data: product, error: productError } = await supabase
      .from("products")
      .select("*")
      .eq("id", productId)
      .single()

    if (productError) {
      throw new ApiError(404, "Product not found")
    }

    // Check stock
    if (product.stock < quantity) {
      throw new ApiError(400, "Not enough stock available")
    }

    let cart
    const query = {}

    if (req.user) {
      query.user_id = req.user.id
    } else if (sessionId) {
      query.session_id = sessionId
    } else {
      throw new ApiError(400, "Session ID is required for guest cart")
    }

    // Find or create cart
    const { data: existingCart, error: cartError } = await supabase.from("carts").select("*").match(query).single()

    if (cartError && cartError.code !== "PGRST116") {
      throw new ApiError(500, "Error retrieving cart", cartError.message)
    }

    if (!existingCart) {
      // Create new cart
      const { data: newCart, error: createError } = await supabase.from("carts").insert(query).select().single()

      if (createError) {
        throw new ApiError(500, "Error creating cart", createError.message)
      }

      cart = newCart
    } else {
      cart = existingCart
    }

    // Check if product already in cart
    const { data: existingItems, error: itemsError } = await supabase
      .from("cart_items")
      .select("*")
      .eq("cart_id", cart.id)
      .eq("product_id", productId)
      .is("variant_id", variantId ? variantId : null)

    if (itemsError) {
      throw new ApiError(500, "Error checking cart items", itemsError.message)
    }

    if (existingItems && existingItems.length > 0) {
      // Update quantity if product already in cart
      const { error: updateError } = await supabase
        .from("cart_items")
        .update({ quantity: existingItems[0].quantity + quantity })
        .eq("id", existingItems[0].id)

      if (updateError) {
        throw new ApiError(500, "Error updating cart item", updateError.message)
      }
    } else {
      // Add new item to cart
      const { error: insertError } = await supabase.from("cart_items").insert({
        cart_id: cart.id,
        product_id: productId,
        variant_id: variantId,
        quantity,
        price: product.price,
        saved_for_later: false,
      })

      if (insertError) {
        throw new ApiError(500, "Error adding item to cart", insertError.message)
      }
    }

    // Recalculate cart totals
    await recalculateCartTotals(cart.id)

    // Get updated cart with items
    const { data: updatedCart, error: updatedCartError } = await supabase
      .from("carts")
      .select("*")
      .eq("id", cart.id)
      .single()

    if (updatedCartError) {
      throw new ApiError(500, "Error retrieving updated cart", updatedCartError.message)
    }

    // Get cart items
    const { data: items, error: updatedItemsError } = await supabase
      .from("cart_items")
      .select(`
        *,
        product:product_id(id, name, price, images, stock),
        variant:variant_id(id, size, color, price, stock)
      `)
      .eq("cart_id", cart.id)

    if (updatedItemsError) {
      throw new ApiError(500, "Error retrieving updated cart items", updatedItemsError.message)
    }

    return res
      .status(200)
      .json(new ApiResponse(200, { ...updatedCart, items: items || [] }, "Item added to cart successfully"))
  } catch (error) {
    next(error)
  }
}

// Update cart item
export const updateCartItem = async (req, res, next) => {
  try {
    const { itemId, quantity, savedForLater } = req.body

    const query = {}
    if (req.user) {
      query.user_id = req.user.id
    } else if (req.body.sessionId) {
      query.session_id = req.body.sessionId
    } else {
      throw new ApiError(400, "Session ID is required for guest cart")
    }

    // Find cart
    const { data: cart, error: cartError } = await supabase.from("carts").select("*").match(query).single()

    if (cartError) {
      throw new ApiError(404, "Cart not found")
    }

    // Find the item in the cart
    const { data: item, error: itemError } = await supabase
      .from("cart_items")
      .select("*")
      .eq("id", itemId)
      .eq("cart_id", cart.id)
      .single()

    if (itemError) {
      throw new ApiError(404, "Item not found in cart")
    }

    // Update item
    const updates = {}

    if (quantity !== undefined) {
      if (quantity <= 0) {
        // Remove item if quantity is 0 or negative
        const { error: deleteError } = await supabase.from("cart_items").delete().eq("id", itemId)

        if (deleteError) {
          throw new ApiError(500, "Error removing cart item", deleteError.message)
        }
      } else {
        // Check stock
        const { data: product, error: productError } = await supabase
          .from("products")
          .select("stock")
          .eq("id", item.product_id)
          .single()

        if (productError || !product) {
          throw new ApiError(404, "Product not found")
        }

        if (product.stock < quantity) {
          throw new ApiError(400, "Not enough stock available")
        }

        updates.quantity = quantity
      }
    }

    if (savedForLater !== undefined) {
      updates.saved_for_later = savedForLater
    }

    // Only update if we have changes and didn't delete the item
    if (Object.keys(updates).length > 0 && quantity > 0) {
      const { error: updateError } = await supabase.from("cart_items").update(updates).eq("id", itemId)

      if (updateError) {
        throw new ApiError(500, "Error updating cart item", updateError.message)
      }
    }

    // Recalculate cart totals
    await recalculateCartTotals(cart.id)

    // Get updated cart with items
    const { data: updatedCart, error: updatedCartError } = await supabase
      .from("carts")
      .select("*")
      .eq("id", cart.id)
      .single()

    if (updatedCartError) {
      throw new ApiError(500, "Error retrieving updated cart", updatedCartError.message)
    }

    // Get cart items
    const { data: items, error: updatedItemsError } = await supabase
      .from("cart_items")
      .select(`
        *,
        product:product_id(id, name, price, images, stock),
        variant:variant_id(id, size, color, price, stock)
      `)
      .eq("cart_id", cart.id)

    if (updatedItemsError) {
      throw new ApiError(500, "Error retrieving updated cart items", updatedItemsError.message)
    }

    return res
      .status(200)
      .json(new ApiResponse(200, { ...updatedCart, items: items || [] }, "Cart updated successfully"))
  } catch (error) {
    next(error)
  }
}

// Remove item from cart
export const removeFromCart = async (req, res, next) => {
  try {
    const { itemId } = req.params

    const query = {}
    if (req.user) {
      query.user_id = req.user.id
    } else if (req.query.sessionId) {
      query.session_id = req.query.sessionId
    } else {
      throw new ApiError(400, "Session ID is required for guest cart")
    }

    // Find cart
    const { data: cart, error: cartError } = await supabase.from("carts").select("*").match(query).single()

    if (cartError) {
      throw new ApiError(404, "Cart not found")
    }

    // Remove item from cart
    const { error: deleteError } = await supabase.from("cart_items").delete().eq("id", itemId).eq("cart_id", cart.id)

    if (deleteError) {
      throw new ApiError(500, "Error removing item from cart", deleteError.message)
    }

    // Recalculate cart totals
    await recalculateCartTotals(cart.id)

    // Get updated cart with items
    const { data: updatedCart, error: updatedCartError } = await supabase
      .from("carts")
      .select("*")
      .eq("id", cart.id)
      .single()

    if (updatedCartError) {
      throw new ApiError(500, "Error retrieving updated cart", updatedCartError.message)
    }

    // Get cart items
    const { data: items, error: updatedItemsError } = await supabase
      .from("cart_items")
      .select(`
        *,
        product:product_id(id, name, price, images, stock),
        variant:variant_id(id, size, color, price, stock)
      `)
      .eq("cart_id", cart.id)

    if (updatedItemsError) {
      throw new ApiError(500, "Error retrieving updated cart items", updatedItemsError.message)
    }

    return res
      .status(200)
      .json(new ApiResponse(200, { ...updatedCart, items: items || [] }, "Item removed from cart successfully"))
  } catch (error) {
    next(error)
  }
}

// Clear cart
export const clearCart = async (req, res, next) => {
  try {
    const query = {}
    if (req.user) {
      query.user_id = req.user.id
    } else if (req.query.sessionId) {
      query.session_id = req.query.sessionId
    } else {
      throw new ApiError(400, "Session ID is required for guest cart")
    }

    // Find cart
    const { data: cart, error: cartError } = await supabase.from("carts").select("*").match(query).single()

    if (cartError) {
      throw new ApiError(404, "Cart not found")
    }

    // Remove all items from cart
    const { error: deleteError } = await supabase.from("cart_items").delete().eq("cart_id", cart.id)

    if (deleteError) {
      throw new ApiError(500, "Error clearing cart", deleteError.message)
    }

    // Reset cart totals
    const { error: updateError } = await supabase
      .from("carts")
      .update({
        subtotal: 0,
        tax_total: 0,
        shipping_total: 0,
        discount_total: 0,
        grand_total: 0,
      })
      .eq("id", cart.id)

    if (updateError) {
      throw new ApiError(500, "Error resetting cart totals", updateError.message)
    }

    return res
      .status(200)
      .json(
        new ApiResponse(
          200,
          { ...cart, items: [], subtotal: 0, tax_total: 0, shipping_total: 0, discount_total: 0, grand_total: 0 },
          "Cart cleared successfully",
        ),
      )
  } catch (error) {
    next(error)
  }
}
