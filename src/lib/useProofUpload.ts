import { useCallback, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { sanitizeFileName } from "@/lib/utils";
import { PROOF_BUCKET, validateUploadFile } from "@/lib/fileUpload";

export interface ProofUpload {
  path: string | null;
  fileName: string | null;
  previewUrl: string | null;
  uploading: boolean;
  error: string | null;
  inputRef: React.RefObject<HTMLInputElement | null>;
  handleFileChange: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  reset: () => void;
  setError: (message: string | null) => void;
}

/**
 * The payment-proof upload flow, in one place.
 *
 * Was written three times — once at checkout and twice on the order tracker
 * (resubmit after a rejection, and the pre-order balance payment). The three
 * differed only in which token prefixes the storage path, which is now the
 * argument.
 *
 * `pathPrefix` scopes the upload: the submission token at checkout, the
 * access token on the tracker. It is null while the tracker is still loading,
 * and a null prefix makes picking a file a no-op.
 */
export function useProofUpload(pathPrefix: string | null): ProofUpload {
  const [path, setPath] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !pathPrefix) return;
      setError(null);
      setPath(null);

      const problem = validateUploadFile(file);
      if (problem) {
        setError(problem);
        return;
      }

      setPreviewUrl(URL.createObjectURL(file));
      setUploading(true);
      const objectPath = `${pathPrefix}/${crypto.randomUUID()}-${sanitizeFileName(file.name)}`;
      const { error: uploadError } = await supabase.storage
        .from(PROOF_BUCKET)
        .upload(objectPath, file, { contentType: file.type });
      setUploading(false);

      if (uploadError) {
        setError("Couldn't upload your payment proof. Please try again.");
        return;
      }
      setPath(objectPath);
      setFileName(file.name);
    },
    [pathPrefix]
  );

  const reset = useCallback(() => {
    setPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });
    setPath(null);
    setFileName(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  return { path, fileName, previewUrl, uploading, error, inputRef, handleFileChange, reset, setError };
}
