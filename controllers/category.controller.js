import supabase from "../utils/supabase.js"
import { ApiError } from "../utils/api-error.js"
import { ApiResponse } from "../utils/api-response.js"
import slugify from "slugify"

// Get all categories
export const getCategories = async (req, res, next) => {
  try {
    const { data: categories, error } = await supabase
      .from("categories")
      .select("*")
      .order("name")
      .eq("is_active", true)

    if (error) {
      throw new ApiError(500, "Error retrieving categories", error.message)
    }

    // Organize categories into a tree structure
    const categoryMap = {}
    const rootCategories = []

    // First pass: create a map of categories by ID
    categories.forEach((category) => {
      category.subcategories = []
      categoryMap[category.id] = category
    })

    // Second pass: build the tree structure
    categories.forEach((category) => {
      if (category.parent_id) {
        const parent = categoryMap[category.parent_id]
        if (parent) {
          parent.subcategories.push(category)
        }
      } else {
        rootCategories.push(category)
      }
    })

    return res.status(200).json(new ApiResponse(200, rootCategories, "Categories retrieved successfully"))
  } catch (error) {
    next(error)
  }
}

// Get category by ID
export const getCategoryById = async (req, res, next) => {
  try {
    const { id } = req.params

    const { data: category, error } = await supabase.from("categories").select("*").eq("id", id).single()

    if (error) {
      throw new ApiError(404, "Category not found")
    }

    // Get subcategories
    const { data: subcategories, error: subError } = await supabase
      .from("categories")
      .select("*")
      .eq("parent_id", id)
      .order("name")

    if (subError) {
      console.error("Error retrieving subcategories:", subError)
    }

    // Get products in this category
    const { data: products, error: productsError } = await supabase
      .from("products")
      .select("id, name, price, images")
      .eq("category_id", id)
      .eq("status", "active")
      .limit(10)

    if (productsError) {
      console.error("Error retrieving category products:", productsError)
    }

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          ...category,
          subcategories: subcategories || [],
          products: products || [],
        },
        "Category retrieved successfully",
      ),
    )
  } catch (error) {
    next(error)
  }
}

// Create category (admin only)
export const createCategory = async (req, res, next) => {
  try {
    const { name, description, parentId, image, isActive } = req.body

    // Generate slug from name
    const slug = slugify(name, { lower: true, strict: true })

    // Check if slug already exists
    const { data: existingCategory, error: checkError } = await supabase
      .from("categories")
      .select("id")
      .eq("slug", slug)
      .single()

    if (existingCategory) {
      throw new ApiError(409, "A category with this name already exists")
    }

    // Determine level
    let level = 1
    if (parentId) {
      const { data: parent, error: parentError } = await supabase
        .from("categories")
        .select("level")
        .eq("id", parentId)
        .single()

      if (parentError) {
        throw new ApiError(404, "Parent category not found")
      }

      level = parent.level + 1
    }

    // Create category
    const { data: category, error } = await supabase
      .from("categories")
      .insert({
        name,
        description,
        slug,
        parent_id: parentId || null,
        level,
        image: image || null,
        is_active: isActive !== undefined ? isActive : true,
      })
      .select()
      .single()

    if (error) {
      throw new ApiError(500, "Error creating category", error.message)
    }

    return res.status(201).json(new ApiResponse(201, category, "Category created successfully"))
  } catch (error) {
    next(error)
  }
}

// Update category (admin only)
export const updateCategory = async (req, res, next) => {
  try {
    const { id } = req.params
    const { name, description, parentId, image, isActive } = req.body

    // Check if category exists
    const { data: existingCategory, error: checkError } = await supabase
      .from("categories")
      .select("*")
      .eq("id", id)
      .single()

    if (checkError) {
      throw new ApiError(404, "Category not found")
    }

    const updates = {}

    // Only update slug if name is changing
    if (name && name !== existingCategory.name) {
      const slug = slugify(name, { lower: true, strict: true })

      // Check if new slug already exists for a different category
      const { data: slugExists, error: slugError } = await supabase
        .from("categories")
        .select("id")
        .eq("slug", slug)
        .neq("id", id)
        .single()

      if (slugExists) {
        throw new ApiError(409, "A category with this name already exists")
      }

      updates.name = name
      updates.slug = slug
    }

    if (description !== undefined) updates.description = description
    if (image !== undefined) updates.image = image
    if (isActive !== undefined) updates.is_active = isActive

    // Handle parent change
    if (parentId !== undefined && parentId !== existingCategory.parent_id) {
      // Prevent setting a category as its own parent
      if (parentId === id) {
        throw new ApiError(400, "A category cannot be its own parent")
      }

      // Check for circular references
      if (parentId) {
        let currentParent = parentId
        let depth = 0
        const maxDepth = 10 // Prevent infinite loops

        while (currentParent && depth < maxDepth) {
          const { data: parent, error: parentError } = await supabase
            .from("categories")
            .select("parent_id")
            .eq("id", currentParent)
            .single()

          if (parentError || !parent) break

          if (parent.parent_id === id) {
            throw new ApiError(400, "This would create a circular reference in the category hierarchy")
          }

          currentParent = parent.parent_id
          depth++
        }

        // Determine new level
        const { data: parent, error: parentError } = await supabase
          .from("categories")
          .select("level")
          .eq("id", parentId)
          .single()

        if (parentError) {
          throw new ApiError(404, "Parent category not found")
        }

        updates.parent_id = parentId
        updates.level = parent.level + 1
      } else {
        updates.parent_id = null
        updates.level = 1
      }
    }

    // Update category
    const { data: category, error } = await supabase.from("categories").update(updates).eq("id", id).select().single()

    if (error) {
      throw new ApiError(500, "Error updating category", error.message)
    }

    return res.status(200).json(new ApiResponse(200, category, "Category updated successfully"))
  } catch (error) {
    next(error)
  }
}

// Delete category (admin only)
export const deleteCategory = async (req, res, next) => {
  try {
    const { id } = req.params

    // Check if category has subcategories
    const { data: subcategories, error: subError } = await supabase.from("categories").select("id").eq("parent_id", id)

    if (subError) {
      throw new ApiError(500, "Error checking subcategories", subError.message)
    }

    if (subcategories && subcategories.length > 0) {
      throw new ApiError(400, "Cannot delete a category that has subcategories")
    }

    // Check if category has products
    const { data: products, error: prodError } = await supabase.from("products").select("id").eq("category_id", id)

    if (prodError) {
      throw new ApiError(500, "Error checking products", prodError.message)
    }

    if (products && products.length > 0) {
      throw new ApiError(400, "Cannot delete a category that has products")
    }

    // Delete category
    const { error } = await supabase.from("categories").delete().eq("id", id)

    if (error) {
      throw new ApiError(500, "Error deleting category", error.message)
    }

    return res.status(200).json(new ApiResponse(200, null, "Category deleted successfully"))
  } catch (error) {
    next(error)
  }
}
