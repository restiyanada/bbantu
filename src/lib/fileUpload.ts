// Mirrors the Storage buckets in supabase/storage_setup.sql and
// supabase/product_images_storage_setup.sql. Both buckets enforce the same
// limits server-side; these exist so the user hears about a bad file before
// spending their upload on it. Change one, change the other.
export const PROOF_BUCKET = "payment-proofs";
export const IMAGE_BUCKET = "product-images";

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

// Every photo is a Storage object and a download on a slow connection. Six is
// enough to show a garment from several angles plus a size chart.
export const MAX_PRODUCT_PHOTOS = 6;

/**
 * Returns the message to show the user, or null when the file is fine.
 * Type is checked before size so a PDF is called a PDF rather than "too large".
 */
export function validateUploadFile(file: { type: string; size: number }): string | null {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type as (typeof ACCEPTED_IMAGE_TYPES)[number])) {
    return "Please upload a JPEG, PNG, or WebP image.";
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return "File is too large — please keep it under 5MB.";
  }
  return null;
}
