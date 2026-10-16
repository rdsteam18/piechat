import type { SupabaseClient } from "@supabase/supabase-js";

export const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,24}$/;
export const MAX_BIO_LENGTH = 160;
export const MAX_DISPLAY_NAME_LENGTH = 60;
export const MAX_AVATAR_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
export const ALLOWED_AVATAR_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];

export function validateUsername(username: string): { valid: boolean; error?: string } {
  const trimmed = username.trim().toLowerCase();
  if (!trimmed) {
    return { valid: false, error: "Username is required." };
  }
  if (trimmed.length < 3) {
    return { valid: false, error: "Username must be at least 3 characters." };
  }
  if (trimmed.length > 24) {
    return { valid: false, error: "Username must be at most 24 characters." };
  }
  if (!USERNAME_REGEX.test(trimmed)) {
    return {
      valid: false,
      error: "Username may only contain letters, numbers, and underscores.",
    };
  }
  return { valid: true };
}

export function validateDisplayName(displayName: string): { valid: boolean; error?: string } {
  const trimmed = displayName.trim();
  if (!trimmed) {
    return { valid: false, error: "Display name cannot be empty." };
  }
  if (trimmed.length > MAX_DISPLAY_NAME_LENGTH) {
    return {
      valid: false,
      error: `Display name must be at most ${MAX_DISPLAY_NAME_LENGTH} characters.`,
    };
  }
  return { valid: true };
}

export function validateBio(bio: string): { valid: boolean; error?: string } {
  if (bio.length > MAX_BIO_LENGTH) {
    return {
      valid: false,
      error: `Bio must be at most ${MAX_BIO_LENGTH} characters.`,
    };
  }
  return { valid: true };
}

export function validateAvatarFile(file: { size: number; type: string }): {
  valid: boolean;
  error?: string;
} {
  if (!ALLOWED_AVATAR_TYPES.includes(file.type)) {
    return {
      valid: false,
      error: "Supported image formats are JPEG, PNG, WebP, and GIF.",
    };
  }
  if (file.size > MAX_AVATAR_SIZE_BYTES) {
    return {
      valid: false,
      error: "Image file size exceeds the 5 MB limit.",
    };
  }
  return { valid: true };
}

/**
 * Uploads an avatar image to Supabase Storage in the 'avatars' bucket.
 * Bucket policy requires path to start with user's ID: `<userId>/...`
 */
export async function uploadAvatar(
  supabase: SupabaseClient,
  userId: string,
  file: File
): Promise<{ url: string; path: string }> {
  const validation = validateAvatarFile(file);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const safeExt = ["jpeg", "jpg", "png", "webp", "gif"].includes(ext) ? ext : "jpg";
  const filePath = `${userId}/avatar-${Date.now()}.${safeExt}`;

  const { error: uploadError } = await supabase.storage
    .from("avatars")
    .upload(filePath, file, {
      cacheControl: "3600",
      upsert: true,
      contentType: file.type,
    });

  if (uploadError) {
    throw new Error(`Upload failed: ${uploadError.message}`);
  }

  const { data: publicData } = supabase.storage
    .from("avatars")
    .getPublicUrl(filePath);

  return { url: publicData.publicUrl, path: filePath };
}

/**
 * Safely removes an avatar file from Supabase Storage if it belongs to the user.
 */
export async function removeAvatar(
  supabase: SupabaseClient,
  avatarUrl: string,
  userId: string
): Promise<void> {
  if (!avatarUrl || !avatarUrl.includes("avatars")) return;

  try {
    // Extract the storage path: e.g. "avatars/<userId>/avatar-..."
    const parts = avatarUrl.split("/avatars/");
    if (parts.length > 1) {
      const storagePath = parts[1].split("?")[0];
      // Only delete if it belongs to the current user
      if (storagePath.startsWith(`${userId}/`)) {
        await supabase.storage.from("avatars").remove([storagePath]);
      }
    }
  } catch {
    // Ignore cleanup errors
  }
}
