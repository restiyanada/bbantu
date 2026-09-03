// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ChangeEvent } from "react";

const upload = vi.fn();
vi.mock("@/lib/supabaseClient", () => ({
  supabase: { storage: { from: () => ({ upload }) } },
}));

import { useProofUpload } from "./useProofUpload";

function changeEvent(file: File | null): ChangeEvent<HTMLInputElement> {
  return { target: { files: file ? [file] : [] } } as unknown as ChangeEvent<HTMLInputElement>;
}

const png = () => new File(["x"], "receipt.png", { type: "image/png" });

beforeEach(() => {
  upload.mockReset().mockResolvedValue({ error: null });
  globalThis.URL.createObjectURL = vi.fn(() => "blob:preview");
  globalThis.URL.revokeObjectURL = vi.fn();
});
afterEach(() => vi.restoreAllMocks());

describe("useProofUpload", () => {
  it("uploads an accepted file under the given prefix and exposes the path", async () => {
    const { result } = renderHook(() => useProofUpload("token-1"));

    await act(async () => {
      await result.current.handleFileChange(changeEvent(png()));
    });

    expect(upload).toHaveBeenCalledTimes(1);
    const [path, , options] = upload.mock.calls[0];
    expect(path).toMatch(/^token-1\/[0-9a-f-]+-receipt\.png$/);
    expect(options).toEqual({ contentType: "image/png" });
    expect(result.current.path).toBe(path);
    expect(result.current.fileName).toBe("receipt.png");
    expect(result.current.previewUrl).toBe("blob:preview");
    expect(result.current.error).toBeNull();
    expect(result.current.uploading).toBe(false);
  });

  it("rejects a bad file without calling storage", async () => {
    const { result } = renderHook(() => useProofUpload("token-1"));
    const pdf = new File(["x"], "receipt.pdf", { type: "application/pdf" });

    await act(async () => {
      await result.current.handleFileChange(changeEvent(pdf));
    });

    expect(upload).not.toHaveBeenCalled();
    expect(result.current.error).toBe("Please upload a JPEG, PNG, or WebP image.");
    expect(result.current.path).toBeNull();
  });

  it("does nothing without a path prefix", async () => {
    const { result } = renderHook(() => useProofUpload(null));

    await act(async () => {
      await result.current.handleFileChange(changeEvent(png()));
    });

    expect(upload).not.toHaveBeenCalled();
    expect(result.current.error).toBeNull();
  });

  it("reports a storage failure in the user's words", async () => {
    upload.mockResolvedValue({ error: { message: "boom" } });
    const { result } = renderHook(() => useProofUpload("token-1"));

    await act(async () => {
      await result.current.handleFileChange(changeEvent(png()));
    });

    expect(result.current.error).toBe("Couldn't upload your payment proof. Please try again.");
    expect(result.current.path).toBeNull();
  });

  it("reset revokes the preview URL and clears state", async () => {
    const { result } = renderHook(() => useProofUpload("token-1"));

    await act(async () => {
      await result.current.handleFileChange(changeEvent(png()));
    });
    act(() => result.current.reset());

    expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview");
    expect(result.current.path).toBeNull();
    expect(result.current.fileName).toBeNull();
    expect(result.current.previewUrl).toBeNull();
    expect(result.current.error).toBeNull();
  });
});
