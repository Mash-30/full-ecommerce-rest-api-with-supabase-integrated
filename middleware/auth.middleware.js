import supabase from "../utils/supabase.js"
import { ApiError } from "../utils/api-error.js"

// Authenticate middleware
export const authenticate = async (req, res, next) => {
  try {
    // Get token from header
    const authHeader = req.headers.authorization
    const token = authHeader && authHeader.startsWith("Bearer ") ? authHeader.split(" ")[1] : null

    if (!token) {
      throw new ApiError(401, "Authentication required")
    }

    // Verify token with Supabase
    const { data: session, error } = await supabase.auth.getSession(token)

    if (error || !session || !session.user) {
      throw new ApiError(401, "Invalid or expired token")
    }

    // Get user profile
    const { data: profile, error: profileError } = await supabase
      .from("user_profiles")
      .select("*")
      .eq("id", session.user.id)
      .single()

    if (profileError) {
      throw new ApiError(500, "Error retrieving user profile")
    }

    // Check if user is active
    if (profile.status !== "active") {
      throw new ApiError(403, "Your account is not active")
    }

    // Set user in request
    req.user = {
      id: session.user.id,
      email: session.user.email,
      role: profile.role,
      ...profile,
    }

    next()
  } catch (error) {
    next(error)
  }
}

// Optional authentication middleware
export const optionalAuth = async (req, res, next) => {
  try {
    // Get token from header
    const authHeader = req.headers.authorization
    const token = authHeader && authHeader.startsWith("Bearer ") ? authHeader.split(" ")[1] : null

    if (!token) {
      return next()
    }

    // Verify token with Supabase
    const { data: session, error } = await supabase.auth.getSession(token)

    if (error || !session || !session.user) {
      return next()
    }

    // Get user profile
    const { data: profile, error: profileError } = await supabase
      .from("user_profiles")
      .select("*")
      .eq("id", session.user.id)
      .single()

    if (!profileError && profile && profile.status === "active") {
      req.user = {
        id: session.user.id,
        email: session.user.email,
        role: profile.role,
        ...profile,
      }
    }

    next()
  } catch (error) {
    // Continue without authentication
    next()
  }
}

// Authorization middleware
export const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(new ApiError(401, "Authentication required"))
    }

    if (!roles.includes(req.user.role)) {
      return next(new ApiError(403, "You are not authorized to perform this action"))
    }

    next()
  }
}
