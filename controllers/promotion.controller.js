import supabase from "../utils/supabase.js"
import { ApiError } from "../utils/api-error.js"
import { ApiResponse } from "../utils/api-response.js"

// Get all promotions (admin)
export const getPromotions = async (req, res, next) => {
  try {
    const { page = 1, limit = 10, active } = req.query

    let query = supabase.from("promotions").select("*", { count: "exact" })

    if (active === "true") {
      const now = new Date().toISOString()
      query = query.eq("is_active", true).lte("start_date", now).gte("end_date", now)
    }

    // Apply pagination
    const from = (Number(page) - 1) * Number(limit)
    const to = from + Number(limit) - 1

    // Execute query
    const { data: promotions, count, error } = await query.order("created_at", { ascending: false }).range(from, to)

    if (error) {
      throw new ApiError(500, "Error retrieving promotions", error.message)
    }

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          promotions,
          pagination: {
            total: count,
            page: Number(page),
            limit: Number(limit),
            pages: Math.ceil(count / Number(limit)),
          },
        },
        "Promotions retrieved successfully",
      ),
    )
  } catch (error) {
    next(error)
  }
}

// Get promotion by ID
export const getPromotionById = async (req, res, next) => {
  try {
    const { id } = req.params

    const { data: promotion, error } = await supabase.from("promotions").select("*").eq("id", id).single()

    if (error) {
      throw new ApiError(404, "Promotion not found")
    }

    return res.status(200).json(new ApiResponse(200, promotion, "Promotion retrieved successfully"))
  } catch (error) {
    next(error)
  }
}

// Create promotion (admin only)
export const createPromotion = async (req, res, next) => {
  try {
    const {
      name,
      description,
      code,
      type,
      value,
      minPurchase,
      maxDiscount,
      startDate,
      endDate,
      isActive,
      usageLimitPerUser,
      usageLimitTotal,
      conditions,
    } = req.body

    // Check if code already exists
    if (code) {
      const { data: existingPromotion, error: checkError } = await supabase
        .from("promotions")
        .select("id")
        .eq("code", code.toUpperCase())
        .single()

      if (!checkError && existingPromotion) {
        throw new ApiError(409, "A promotion with this code already exists")
      }
    }

    // Create promotion
    const { data: promotion, error } = await supabase
      .from("promotions")
      .insert({
        name,
        description,
        code: code ? code.toUpperCase() : null,
        type,
        value,
        min_purchase: minPurchase || 0,
        max_discount: maxDiscount,
        start_date: startDate,
        end_date: endDate,
        is_active: isActive !== undefined ? isActive : true,
        usage_limit_per_user: usageLimitPerUser,
        usage_limit_total: usageLimitTotal,
        usage_count: 0,
        conditions: conditions || null,
      })
      .select()
      .single()

    if (error) {
      throw new ApiError(500, "Error creating promotion", error.message)
    }

    return res.status(201).json(new ApiResponse(201, promotion, "Promotion created successfully"))
  } catch (error) {
    next(error)
  }
}

// Update promotion (admin only)
export const updatePromotion = async (req, res, next) => {
  try {
    const { id } = req.params
    const {
      name,
      description,
      code,
      type,
      value,
      minPurchase,
      maxDiscount,
      startDate,
      endDate,
      isActive,
      usageLimitPerUser,
      usageLimitTotal,
      conditions,
    } = req.body

    // Check if promotion exists
    const { data: existingPromotion, error: checkError } = await supabase
      .from("promotions")
      .select("*")
      .eq("id", id)
      .single()

    if (checkError) {
      throw new ApiError(404, "Promotion not found")
    }

    // Check if code already exists (if changing)
    if (code && code !== existingPromotion.code) {
      const { data: codeExists, error: codeError } = await supabase
        .from("promotions")
        .select("id")
        .eq("code", code.toUpperCase())
        .neq("id", id)
        .single()

      if (!codeError && codeExists) {
        throw new ApiError(409, "A promotion with this code already exists")
      }
    }

    // Update promotion
    const updates = {}
    if (name !== undefined) updates.name = name
    if (description !== undefined) updates.description = description
    if (code !== undefined) updates.code = code ? code.toUpperCase() : null
    if (type !== undefined) updates.type = type
    if (value !== undefined) updates.value = value
    if (minPurchase !== undefined) updates.min_purchase = minPurchase
    if (maxDiscount !== undefined) updates.max_discount = maxDiscount
    if (startDate !== undefined) updates.start_date = startDate
    if (endDate !== undefined) updates.end_date = endDate
    if (isActive !== undefined) updates.is_active = isActive
    if (usageLimitPerUser !== undefined) updates.usage_limit_per_user = usageLimitPerUser
    if (usageLimitTotal !== undefined) updates.usage_limit_total = usageLimitTotal
    if (conditions !== undefined) updates.conditions = conditions

    const { data: promotion, error } = await supabase.from("promotions").update(updates).eq("id", id).select().single()

    if (error) {
      throw new ApiError(500, "Error updating promotion", error.message)
    }

    return res.status(200).json(new ApiResponse(200, promotion, "Promotion updated successfully"))
  } catch (error) {
    next(error)
  }
}

// Delete promotion (admin only)
export const deletePromotion = async (req, res, next) => {
  try {
    const { id } = req.params

    // Check if promotion is being used in any active carts
    const { data: usedInCarts, error: cartError } = await supabase
      .from("applied_coupons")
      .select("id")
      .eq("promotion_id", id)

    if (cartError) {
      throw new ApiError(500, "Error checking promotion usage", cartError.message)
    }

    if (usedInCarts && usedInCarts.length > 0) {
      throw new ApiError(400, "Cannot delete a promotion that is currently in use")
    }

    // Delete promotion
    const { error } = await supabase.from("promotions").delete().eq("id", id)

    if (error) {
      throw new ApiError(500, "Error deleting promotion", error.message)
    }

    return res.status(200).json(new ApiResponse(200, null, "Promotion deleted successfully"))
  } catch (error) {
    next(error)
  }
}

// Apply coupon to cart
export const applyCoupon = async (req, res, next) => {
  try {
    const { code, sessionId } = req.body

    if (!code) {
      throw new ApiError(400, "Coupon code is required")
    }

    // Find promotion by code
    const { data: promotion, error: promoError } = await supabase
      .from("promotions")
      .select("*")
      .eq("code", code.toUpperCase())
      .single()

    if (promoError) {
      throw new ApiError(404, "Invalid coupon code")
    }

    // Validate promotion
    const now = new Date().toISOString()
    if (!promotion.is_active || promotion.start_date > now || promotion.end_date < now) {
      throw new ApiError(400, "This coupon has expired or is not active")
    }

    // Check usage limits
    if (promotion.usage_limit_total && promotion.usage_count >= promotion.usage_limit_total) {
      throw new ApiError(400, "This coupon has reached its usage limit")
    }

    // Find cart
    const query = {}
    if (req.user) {
      query.user_id = req.user.id
    } else if (sessionId) {
      query.session_id = sessionId
    } else {
      throw new ApiError(400, "Session ID is required for guest cart")
    }

    const { data: cart, error: cartError } = await supabase.from("carts").select("*").match(query).single()

    if (cartError) {
      throw new ApiError(404, "Cart not found")
    }

    // Check if coupon already applied
    const { data: existingCoupon, error: couponError } = await supabase
      .from("applied_coupons")
      .select("*")
      .eq("cart_id", cart.id)
      .eq("promotion_id", promotion.id)
      .single()

    if (!couponError && existingCoupon) {
      throw new ApiError(400, "This coupon has already been applied")
    }

    // Check minimum purchase requirement
    if (promotion.min_purchase > 0 && cart.subtotal < promotion.min_purchase) {
      throw new ApiError(400, `This coupon requires a minimum purchase of $${promotion.min_purchase.toFixed(2)}`)
    }

    // Calculate discount
    let discount = 0
    if (promotion.type === "percentage") {
      discount = (cart.subtotal * promotion.value) / 100
      if (promotion.max_discount && discount > promotion.max_discount) {
        discount = promotion.max_discount
      }
    } else if (promotion.type === "fixed") {
      discount = promotion.value
      if (discount > cart.subtotal) {
        discount = cart.subtotal
      }
    } else if (promotion.type === "free_shipping") {
      discount = cart.shipping_total
    }

    // Apply coupon to cart
    const { data: appliedCoupon, error: applyError } = await supabase
      .from("applied_coupons")
      .insert({
        cart_id: cart.id,
        promotion_id: promotion.id,
        code: promotion.code,
        discount,
      })
      .select()
      .single()

    if (applyError) {
      throw new ApiError(500, "Error applying coupon", applyError.message)
    }

    // Update cart totals
    const { error: updateError } = await supabase
      .from("carts")
      .update({
        discount_total: cart.discount_total + discount,
        grand_total: cart.grand_total - discount,
      })
      .eq("id", cart.id)

    if (updateError) {
      throw new ApiError(500, "Error updating cart totals", updateError.message)
    }

    // Increment promotion usage count
    const { error: usageError } = await supabase
      .from("promotions")
      .update({
        usage_count: promotion.usage_count + 1,
      })
      .eq("id", promotion.id)

    if (usageError) {
      console.error("Error updating promotion usage count:", usageError)
    }

    // Get updated cart
    const { data: updatedCart, error: updatedCartError } = await supabase
      .from("carts")
      .select("*")
      .eq("id", cart.id)
      .single()

    if (updatedCartError) {
      throw new ApiError(500, "Error retrieving updated cart", updatedCartError.message)
    }

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          cart: updatedCart,
          appliedCoupon,
        },
        "Coupon applied successfully",
      ),
    )
  } catch (error) {
    next(error)
  }
}

// Remove coupon from cart
export const removeCoupon = async (req, res, next) => {
  try {
    const { couponId } = req.params
    const { sessionId } = req.query

    // Find cart
    const query = {}
    if (req.user) {
      query.user_id = req.user.id
    } else if (sessionId) {
      query.session_id = sessionId
    } else {
      throw new ApiError(400, "Session ID is required for guest cart")
    }

    const { data: cart, error: cartError } = await supabase.from("carts").select("*").match(query).single()

    if (cartError) {
      throw new ApiError(404, "Cart not found")
    }

    // Find applied coupon
    const { data: coupon, error: couponError } = await supabase
      .from("applied_coupons")
      .select("*")
      .eq("id", couponId)
      .eq("cart_id", cart.id)
      .single()

    if (couponError) {
      throw new ApiError(404, "Coupon not found in cart")
    }

    // Remove coupon
    const { error: removeError } = await supabase.from("applied_coupons").delete().eq("id", couponId)

    if (removeError) {
      throw new ApiError(500, "Error removing coupon", removeError.message)
    }

    // Update cart totals
    const { error: updateError } = await supabase
      .from("carts")
      .update({
        discount_total: cart.discount_total - coupon.discount,
        grand_total: cart.grand_total + coupon.discount,
      })
      .eq("id", cart.id)

    if (updateError) {
      throw new ApiError(500, "Error updating cart totals", updateError.message)
    }

    // Get updated cart
    const { data: updatedCart, error: updatedCartError } = await supabase
      .from("carts")
      .select("*")
      .eq("id", cart.id)
      .single()

    if (updatedCartError) {
      throw new ApiError(500, "Error retrieving updated cart", updatedCartError.message)
    }

    return res.status(200).json(new ApiResponse(200, updatedCart, "Coupon removed successfully"))
  } catch (error) {
    next(error)
  }
}
