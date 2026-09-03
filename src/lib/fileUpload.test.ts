import { describe, it, expect } from "vitest";
import { validateUploadFile, MAX_UPLOAD_BYTES, ACCEPTED_IMAGE_TYPES } from "./fileUpload";

describe("validateUploadFile", () => {
  it("accepts a small JPEG", () => {
    expect(validateUploadFile({ type: "image/jpeg", size: 1024 })).toBeNull();
  });

  it("accepts every type the storage bucket allows", () => {
    for (const type of ACCEPTED_IMAGE_TYPES) {
      expect(validateUploadFile({ type, size: 1024 })).toBeNull();
    }
  });

  it("rejects a PDF with the wording the UI shows", () => {
    expect(validateUploadFile({ type: "application/pdf", size: 1024 })).toBe(
      "Please upload a JPEG, PNG, or WebP image."
    );
  });

  it("rejects a file over the size cap", () => {
    expect(validateUploadFile({ type: "image/png", size: MAX_UPLOAD_BYTES + 1 })).toBe(
      "File is too large — please keep it under 5MB."
    );
  });

  it("accepts a file exactly at the cap", () => {
    expect(validateUploadFile({ type: "image/png", size: MAX_UPLOAD_BYTES })).toBeNull();
  });

  it("reports the type problem first when a file is both wrong-type and oversized", () => {
    expect(validateUploadFile({ type: "application/pdf", size: MAX_UPLOAD_BYTES + 1 })).toBe(
      "Please upload a JPEG, PNG, or WebP image."
    );
  });
});
