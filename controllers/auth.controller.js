import supabase from "../utils/supabase.js"
import { ApiError } from "../utils/api-error.js"
import { ApiResponse } from "../utils/api-response.js"

// Register a new user
export const register = async (req, res, next) => {
  try {
    const { firstName, lastName, email, password } = req.body

    // Register user with Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          first_name: firstName,
          last_name: lastName,
        },
      },
    })

    if (authError) {
      throw new ApiError(400, "Error registering user", authError.message)
    }

    // Create user profile
    const { data: profileData, error: profileError } = await supabase
      .from("user_profiles")
      .insert({
        id: authData.user.id,
        first_name: firstName,
        last_name: lastName,
        role: "customer",
        status: "active",
      })
      .select()
      .single()

    if (profileError) {
      throw new ApiError(400, "Error creating user profile", profileError.message)
    }

    return res
      .status(201)
      .json(
        new ApiResponse(
          201,
          { user: authData.user },
          "User registered successfully. Please check your email to confirm your account.",
        ),
      )
  } catch (error) {
    next(error)
  }
}

// Login user
export const login = async (req, res, next) => {
  try {
    const { email, password } = req.body

    // Sign in with Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (authError) {
      throw new ApiError(401, "Invalid email or password")
    }

    // Update last login
    const { error: updateError } = await supabase
      .from("user_profiles")
      .update({ last_login: new Date().toISOString() })
      .eq("id", authData.user.id)

    if (updateError) {
      console.error("Error updating last login:", updateError)
    }

    // Get user profile
    const { data: profile, error: profileError } = await supabase
      .from("user_profiles")
      .select("*")
      .eq("id", authData.user.id)
      .single()

    if (profileError) {
      throw new ApiError(500, "Error retrieving user profile")
    }

    // Check if user is active
    if (profile.status !== "active") {
      throw new ApiError(403, "Your account is not active")
    }

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          user: authData.user,
          profile,
          session: authData.session,
        },
        "Login successful",
      ),
    )
  } catch (error) {
    next(error)
  }
}

// Forgot password
export const forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${process.env.FRONTEND_URL}/reset-password`,
    })

    if (error) {
      throw new ApiError(400, "Error sending password reset email", error.message)
    }

    return res
      .status(200)
      .json(new ApiResponse(200, null, "If your email is registered, you will receive a password reset link"))
  } catch (error) {
    next(error)
  }
}

// Reset password
export const resetPassword = async (req, res, next) => {
  try {
    const { password } = req.body

    // The access token should be sent in the Authorization header
    const { error } = await supabase.auth.updateUser({
      password,
    })

    if (error) {
      throw new ApiError(400, "Error resetting password", error.message)
    }

    return res.status(200).json(new ApiResponse(200, null, "Password reset successful"))
  } catch (error) {
    next(error)
  }
}

// Get current user
export const getCurrentUser = async (req, res, next) => {
  try {
    // Get user profile
    const { data: profile, error } = await supabase.from("user_profiles").select("*").eq("id", req.user.id).single()

    if (error) {
      throw new ApiError(404, "User profile not found")
    }

    // Get user addresses
    const { data: addresses, error: addressError } = await supabase
      .from("user_addresses")
      .select("*")
      .eq("user_id", req.user.id)

    if (addressError) {
      console.error("Error retrieving user addresses:", addressError)
    }

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          user: req.user,
          profile,
          addresses: addresses || [],
        },
        "User retrieved successfully",
      ),
    )
  } catch (error) {
    next(error)
  }
}

// Update user profile
export const updateProfile = async (req, res, next) => {
  try {
    const { firstName, lastName, phone } = req.body

    // Update user profile
    const { data: profile, error } = await supabase
      .from("user_profiles")
      .update({
        first_name: firstName,
        last_name: lastName,
        phone,
      })
      .eq("id", req.user.id)
      .select()
      .single()

    if (error) {
      throw new ApiError(400, "Error updating profile", error.message)
    }

    return res.status(200).json(new ApiResponse(200, profile, "Profile updated successfully"))
  } catch (error) {
    next(error)
  }
}

// Add user address
export const addAddress = async (req, res, next) => {
  try {
    const addressData = {
      ...req.body,
      user_id: req.user.id,
    }

    // If this is the default address, unset any existing default of the same type
    if (addressData.is_default) {
      const { error: updateError } = await supabase
        .from("user_addresses")
        .update({ is_default: false })
        .eq("user_id", req.user.id)
        .eq("type", addressData.type)

      if (updateError) {
        console.error("Error updating existing default addresses:", updateError)
      }
    }

    // Insert the new address
    const { data: address, error } = await supabase.from("user_addresses").insert(addressData).select().single()

    if (error) {
      throw new ApiError(400, "Error adding address", error.message)
    }

    return res.status(201).json(new ApiResponse(201, address, "Address added successfully"))
  } catch (error) {
    next(error)
  }
}

// Verify email
export const verifyEmail = async (req, res, next) => {
  try {
    const { token } = req.params

    const { data, error } = await supabase.auth.verifyOtp({
      token,
      type: "email",
    })

    if (error) {
      throw new ApiError(400, "Error verifying email", error.message)
    }

    // Optionally, update user profile to mark email as verified
    const { error: profileError } = await supabase
      .from("user_profiles")
      .update({ is_email_verified: true })
      .eq("id", data.user.id)

    if (profileError) {
      console.error("Error updating user profile:", profileError)
    }

    return res.status(200).json(new ApiResponse(200, null, "Email verified successfully"))
  } catch (error) {
    next(error)
  }
}
