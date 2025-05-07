import supabase from "../utils/supabase.js"
import { ApiError } from "../utils/api-error.js"
import { ApiResponse } from "../utils/api-response.js"

// Create order
export const createOrder = async (req, res, next) => {
  try {
    const { shippingAddress, billingAddress, paymentMethod, shippingMethod, notes, sessionId } = req.body

    // Find user's cart
    const query = {}
    if (req.user) {
      query.user_id = req.user.id
    } else if (sessionId) {
      query.session_id = sessionId
    } else {
      throw new ApiError(400, "Session ID is required for guest checkout")
    }

    // Get cart
    const { data: cart, error: cartError } = await supabase.from("carts").select("*").match(query).single()

    if (cartError) {
      throw new ApiError(404, "Cart not found")
    }

    // Get cart items
    const { data: cartItems, error: itemsError } = await supabase
      .from("cart_items")
      .select(`
        *,
        product:product_id(id, name, price, stock, sku)
      `)
      .eq("cart_id", cart.id)
      .eq("saved_for_later", false)

    if (itemsError) {
      throw new ApiError(500, "Error retrieving cart items", itemsError.message)
    }

    if (!cartItems || cartItems.length === 0) {
      throw new ApiError(400, "Cart is empty")
    }

    // Validate stock for all items
    for (const item of cartItems) {
      if (!item.product || item.product.stock < item.quantity) {
        throw new ApiError(400, `Not enough stock for ${item.product ? item.product.name : "a product"}`)
      }
    }

    // Create new order
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .insert({
        user_id: req.user ? req.user.id : null,
        email: req.user ? req.user.email : req.body.email,
        status: "pending",
        payment_method: paymentMethod,
        shipping_method: shippingMethod,
        subtotal: cart.subtotal,
        discount_total: cart.discount_total,
        tax_total: cart.tax_total,
        shipping_total: cart.shipping_total,
        grand_total: cart.grand_total,
        notes,
      })
      .select()
      .single()

    if (orderError) {
      throw new ApiError(500, "Error creating order", orderError.message)
    }

    // Create order items
    const orderItems = cartItems.map((item) => ({
      order_id: order.id,
      product_id: item.product_id,
      variant_id: item.variant_id,
      name: item.product.name,
      sku: item.product.sku,
      price: item.price,
      quantity: item.quantity,
      subtotal: item.price * item.quantity,
    }))

    const { error: orderItemsError } = await supabase.from("order_items").insert(orderItems)

    if (orderItemsError) {
      throw new ApiError(500, "Error creating order items", orderItemsError.message)
    }

    // Create order addresses
    const addresses = [
      {
        order_id: order.id,
        type: "shipping",
        ...shippingAddress,
      },
      {
        order_id: order.id,
        type: "billing",
        ...billingAddress,
      },
    ]

    const { error: addressesError } = await supabase.from("order_addresses").insert(addresses)

    if (addressesError) {
      throw new ApiError(500, "Error creating order addresses", addressesError.message)
    }

    // Create initial status history
    const { error: statusError } = await supabase.from("order_status_history").insert({
      order_id: order.id,
      status: "pending",
      note: "Order created",
    })

    if (statusError) {
      throw new ApiError(500, "Error creating status history", statusError.message)
    }

    // Update product stock
    for (const item of cartItems) {
      const { error: stockError } = await supabase
        .from("products")
        .update({ stock: item.product.stock - item.quantity })
        .eq("id", item.product_id)

      if (stockError) {
        console.error("Error updating product stock:", stockError)
      }
    }

    // Clear cart items
    const { error: clearCartError } = await supabase.from("cart_items").delete().eq("cart_id", cart.id)

    if (clearCartError) {
      console.error("Error clearing cart items:", clearCartError)
    }

    // Reset cart totals
    const { error: resetCartError } = await supabase
      .from("carts")
      .update({
        subtotal: 0,
        discount_total: 0,
        tax_total: 0,
        shipping_total: 0,
        grand_total: 0,
      })
      .eq("id", cart.id)

    if (resetCartError) {
      console.error("Error resetting cart totals:", resetCartError)
    }

    // Get complete order with items and addresses
    const { data: completeOrder, error: completeOrderError } = await supabase
      .from("orders")
      .select(
        `
        *,
        items:order_items(*),
        addresses:order_addresses(*),
        status_history:order_status_history(*)
      `,
      )
      .eq("id", order.id)
      .single()

    if (completeOrderError) {
      throw new ApiError(500, "Error retrieving complete order", completeOrderError.message)
    }

    return res.status(201).json(new ApiResponse(201, completeOrder, "Order created successfully"))
  } catch (error) {
    next(error)
  }
}

// Get orders for current user
export const getUserOrders = async (req, res, next) => {
  try {
    const { page = 1, limit = 10 } = req.query

    // Count total orders
    const { count, error: countError } = await supabase
      .from("orders")
      .select("*", { count: "exact", head: true })
      .eq("user_id", req.user.id)

    if (countError) {
      throw new ApiError(500, "Error counting orders", countError.message)
    }

    // Get paginated orders
    const from = (Number(page) - 1) * Number(limit)
    const to = from + Number(limit) - 1

    const { data: orders, error } = await supabase
      .from("orders")
      .select("id, order_number, status, grand_total, created_at")
      .eq("user_id", req.user.id)
      .order("created_at", { ascending: false })
      .range(from, to)

    if (error) {
      throw new ApiError(500, "Error retrieving orders", error.message)
    }

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          orders,
          pagination: {
            total: count,
            page: Number(page),
            limit: Number(limit),
            pages: Math.ceil(count / Number(limit)),
          },
        },
        "Orders retrieved successfully",
      ),
    )
  } catch (error) {
    next(error)
  }
}

// Get order by ID
export const getOrderById = async (req, res, next) => {
  try {
    const { id } = req.params

    const { data: order, error } = await supabase
      .from("orders")
      .select(
        `
        *,
        items:order_items(*),
        addresses:order_addresses(*),
        status_history:order_status_history(*)
      `,
      )
      .eq("id", id)
      .single()

    if (error) {
      throw new ApiError(404, "Order not found")
    }

    // Check if the order belongs to the current user (unless admin)
    if (req.user.role !== "admin" && order.user_id && order.user_id !== req.user.id) {
      throw new ApiError(403, "You are not authorized to view this order")
    }

    return res.status(200).json(new ApiResponse(200, order, "Order retrieved successfully"))
  } catch (error) {
    next(error)
  }
}

// Update order status (admin only)
export const updateOrderStatus = async (req, res, next) => {
  try {
    const { id } = req.params
    const { status, note } = req.body

    // Check if order exists
    const { data: order, error: orderError } = await supabase.from("orders").select("*").eq("id", id).single()

    if (orderError) {
      throw new ApiError(404, "Order not found")
    }

    // Update order status
    const { error: updateError } = await supabase.from("orders").update({ status }).eq("id", id)

    if (updateError) {
      throw new ApiError(500, "Error updating order status", updateError.message)
    }

    // Add status history entry
    const { error: historyError } = await supabase.from("order_status_history").insert({
      order_id: id,
      status,
      note: note || `Status updated to ${status}`,
    })

    if (historyError) {
      throw new ApiError(500, "Error adding status history", historyError.message)
    }

    // Get updated order
    const { data: updatedOrder, error } = await supabase
      .from("orders")
      .select(
        `
        *,
        items:order_items(*),
        addresses:order_addresses(*),
        status_history:order_status_history(*)
      `,
      )
      .eq("id", id)
      .single()

    if (error) {
      throw new ApiError(500, "Error retrieving updated order", error.message)
    }

    return res.status(200).json(new ApiResponse(200, updatedOrder, "Order status updated successfully"))
  } catch (error) {
    next(error)
  }
}

// Cancel order
export const cancelOrder = async (req, res, next) => {
  try {
    const { id } = req.params
    const { reason } = req.body

    // Check if order exists
    const { data: order, error: orderError } = await supabase.from("orders").select("*").eq("id", id).single()

    if (orderError) {
      throw new ApiError(404, "Order not found")
    }

    // Check if the order belongs to the current user (unless admin)
    if (req.user.role !== "admin" && order.user_id && order.user_id !== req.user.id) {
      throw new ApiError(403, "You are not authorized to cancel this order")
    }

    // Check if order can be cancelled
    if (!["pending", "processing"].includes(order.status)) {
      throw new ApiError(400, "This order cannot be cancelled")
    }

    // Update order status
    const { error: updateError } = await supabase.from("orders").update({ status: "cancelled" }).eq("id", id)

    if (updateError) {
      throw new ApiError(500, "Error cancelling order", updateError.message)
    }

    // Add status history entry
    const { error: historyError } = await supabase.from("order_status_history").insert({
      order_id: id,
      status: "cancelled",
      note: reason || "Order cancelled by user",
    })

    if (historyError) {
      throw new ApiError(500, "Error adding status history", historyError.message)
    }

    // Get order items to restore stock
    const { data: items, error: itemsError } = await supabase.from("order_items").select("*").eq("order_id", id)

    if (itemsError) {
      console.error("Error retrieving order items:", itemsError)
    } else {
      // Restore product stock
      for (const item of items) {
        const { error: stockError } = await supabase
          .from("products")
          .update({
            stock: supabase.rpc("increment", { row_id: item.product_id, increment_by: item.quantity }),
          })
          .eq("id", item.product_id)

        if (stockError) {
          console.error("Error restoring product stock:", stockError)
        }
      }
    }

    // Get updated order
    const { data: updatedOrder, error } = await supabase
      .from("orders")
      .select(
        `
        *,
        items:order_items(*),
        addresses:order_addresses(*),
        status_history:order_status_history(*)
      `,
      )
      .eq("id", id)
      .single()

    if (error) {
      throw new ApiError(500, "Error retrieving updated order", error.message)
    }

    return res.status(200).json(new ApiResponse(200, updatedOrder, "Order cancelled successfully"))
  } catch (error) {
    next(error)
  }
}
