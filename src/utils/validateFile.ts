export function validatePaymentProof(file: File): { valid: boolean; error?: string } {
  const MAX_SIZE = 2 * 1024 * 1024;
  if (file.size > MAX_SIZE) return { valid: false, error: 'File too large (max 2MB).' };
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowedTypes.includes(file.type)) return { valid: false, error: 'Only JPEG, PNG, or WEBP images are allowed.' };
  return { valid: true };
}

export async function checkMagicBytes(file: File): Promise<boolean> {
  const buffer = await file.slice(0, 4).arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(' ');
  return hex.startsWith('ff d8 ff') || hex.startsWith('89 50 4e 47') || hex.startsWith('52 49 46 46');
}
