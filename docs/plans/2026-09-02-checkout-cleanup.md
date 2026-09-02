# Checkout Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove three duplicate copies of the payment-proof upload flow and break the 1177-line `HomePage.tsx` into focused checkout modules, with no change to user-visible behaviour.

**Architecture:** Two movements, in order. First, lift the proof-upload flow (validate → object URL preview → Storage upload → path) into one `useProofUpload` hook plus a shared constants/validation module, and adopt it at all three call sites. Second, pull `HomePage`'s shipping-selection state into a hook and its four render sections into presentational step components, leaving `HomePage` as a coordinator. Nothing changes on screen; the existing 48-test Playwright suite is the contract.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind v4, Radix, `react-hook-form` + Zod, supabase-js, Vitest (`jsdom` per-file), Playwright.

**Spec:** No separate spec document. The scope was agreed in session and is restated under "Spec" below; the plan argues from that section.

## Spec

1. The payment-proof upload flow is written three times — `HomePage.handleProofFileChange` (`src/pages/HomePage.tsx:383-410`), `OrderPage.handleResubmitFileChange` (`src/pages/OrderPage.tsx:238-265`), and `OrderPage.handleBalanceFileChange` (`src/pages/OrderPage.tsx:299-326`). The three differ only in the storage path prefix (`submissionToken` vs `accessToken`) and in which state setters they call. Collapse them to one hook.
2. `MAX_PROOF_BYTES` / `ACCEPTED_PROOF_TYPES` / `PROOF_BUCKET` are declared twice (`HomePage.tsx:101-103`, `OrderPage.tsx:105-107`) and near-copied a third time as `MAX_IMAGE_BYTES` / `ACCEPTED_IMAGE_TYPES` in `AdminProductsPage.tsx:19-20`. Declare them once.
3. `AdminProductsPage`'s photo picker is **not** in scope for the hook: it takes multiple files, defers upload to form submit, supports reordering and a six-photo cap. Only its validation predicate and constants are shared. Do not force it onto `useProofUpload`.
4. `src/pages/HomePage.tsx` is 1177 lines with 27 `useState` calls. Extract the shipping-selection state (10 of those) into a hook, and the four render sections into components, so the page reads as a coordinator.
5. No user-visible behaviour changes. Every task keeps `npx playwright test` at 48 passing.

## Global Constraints

- **No behaviour change.** If a task would alter what a user sees or what request goes out, stop and raise it. The one deliberate exception is named in Task 3 (a preview-URL leak fixed by using the hook's `reset`).
- **Vitest environment.** The suite runs under `environment: 'node'` (`vite.config.ts:32`). Any test needing a DOM must open with the file-level pragma `// @vitest-environment jsdom`, as `src/components/__tests__/data-table.test.tsx:1` does.
- **Import alias.** `@/` resolves to `src/` (`vite.config.ts:28`). Use it in `src/`; `lib/` at the repo root is Deno-shared code and is a different tree — do not put browser code there.
- **Proof limits are exactly:** bucket `payment-proofs`, max `5 * 1024 * 1024` bytes, types `["image/jpeg", "image/png", "image/webp"]`. These mirror the Storage bucket in `supabase/storage_setup.sql:24-33`; changing them here without changing that file breaks uploads.
- **Product image limits are exactly:** bucket `product-images`, max `5 * 1024 * 1024` bytes, same three types, max 6 photos.
- **Copy is verbatim.** Error strings must not be reworded: `"Please upload a JPEG, PNG, or WebP image."`, `"File is too large — please keep it under 5MB."`, `"Couldn't upload your payment proof. Please try again."`, `"Photos must be JPEG, PNG, or WebP."`, `"Each photo must be under 5MB."` The E2E tests and the users both depend on these.
- **Commit per task.** Conventional Commits (`refactor:`, `test:`). Do not squash tasks together.

## Testing Note (read before Task 1)

This is a refactor, so the usual write-a-failing-test-for-new-behaviour cycle
applies to only part of it:

- **Tasks 1 and 2** create genuinely new modules. They follow full TDD — the
  test fails because the module does not exist yet.
- **Tasks 3–10** move existing code. There is no new behaviour to test-drive.
  Their gate is the existing suite: run it before the change (must be green),
  make the change, run it again (must still be green). Where an extraction
  removes the only coverage of a seam, the task adds a test for that seam.

Do not fabricate failing tests for code that already works.

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `src/lib/fileUpload.ts` | Bucket names, size/type limits, and the `validateUploadFile` predicate. No React. |
| `src/lib/fileUpload.test.ts` | Unit tests for `validateUploadFile`. |
| `src/lib/useProofUpload.ts` | The one payment-proof upload hook: pick → validate → preview → upload → path. |
| `src/lib/useProofUpload.test.tsx` | Unit tests for the hook (jsdom). |
| `src/lib/useShippingSelection.ts` | Province/city/district cascade and JNE rate fetching for checkout. |
| `src/components/checkout/CheckoutSteps.tsx` | The three-step progress indicator. |
| `src/components/checkout/CheckoutNavBar.tsx` | The sticky bottom bar (cart total + back/continue/submit). |
| `src/components/checkout/ChooseItemsStep.tsx` | Step 1 — source tabs, product cards, quantity pickers. |
| `src/components/checkout/YourDetailsStep.tsx` | Step 2 — customer fields, fulfilment choice, address and rates. |
| `src/components/checkout/ReviewPayStep.tsx` | Step 3 — order summary, bank details, proof upload. |

**Modified**

| File | Change |
|---|---|
| `src/pages/HomePage.tsx` | Loses its proof-upload block, shipping block, and four render sections; keeps load, cart, step and submit coordination. |
| `src/pages/OrderPage.tsx` | Both upload blocks replaced by two `useProofUpload` calls. |
| `src/pages/AdminProductsPage.tsx` | Local image constants replaced by the shared ones; keeps its own multi-file picker. |

---

### Task 1: Shared upload constants and validation

**Files:**
- Create: `src/lib/fileUpload.ts`
- Create: `src/lib/fileUpload.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `PROOF_BUCKET: "payment-proofs"`, `IMAGE_BUCKET: "product-images"`
  - `MAX_UPLOAD_BYTES: number` (5 \* 1024 \* 1024)
  - `ACCEPTED_IMAGE_TYPES: readonly string[]`
  - `MAX_PRODUCT_PHOTOS: number` (6)
  - `validateUploadFile(file: { type: string; size: number }): string | null` — returns an error message, or `null` when the file is acceptable.

- [ ] **Step 1: Write the failing test**

Create `src/lib/fileUpload.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/fileUpload.test.ts`
Expected: FAIL — `Failed to resolve import "./fileUpload"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/fileUpload.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/fileUpload.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Typecheck**

Run: `npx tsc -b`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/lib/fileUpload.ts src/lib/fileUpload.test.ts
git commit -m "test: add shared upload constants and file validation"
```

---

### Task 2: The `useProofUpload` hook

**Files:**
- Create: `src/lib/useProofUpload.ts`
- Create: `src/lib/useProofUpload.test.tsx`

**Interfaces:**
- Consumes: `validateUploadFile`, `PROOF_BUCKET` from `@/lib/fileUpload` (Task 1); `supabase` from `@/lib/supabaseClient`.
- Produces:

```ts
export interface ProofUpload {
  path: string | null;          // storage path once uploaded; null until then
  fileName: string | null;      // original name, for display
  previewUrl: string | null;    // object URL, for the <img> preview
  uploading: boolean;
  error: string | null;
  inputRef: React.RefObject<HTMLInputElement | null>;
  handleFileChange: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  reset: () => void;            // revokes the object URL and clears everything
  setError: (message: string | null) => void;
}

export function useProofUpload(pathPrefix: string | null): ProofUpload;
```

`pathPrefix` is the first storage path segment — the submission token at checkout, the access token on the tracker. A `null` prefix makes `handleFileChange` a no-op, matching today's `if (!file || !accessToken) return;` guard.

- [ ] **Step 1: Write the failing test**

Create `src/lib/useProofUpload.test.tsx`:

```tsx
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/useProofUpload.test.tsx`
Expected: FAIL — `Failed to resolve import "./useProofUpload"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/useProofUpload.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/useProofUpload.test.tsx`
Expected: PASS — 5 tests.

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc -b && npm run lint`
Expected: no output from either.

- [ ] **Step 6: Commit**

```bash
git add src/lib/useProofUpload.ts src/lib/useProofUpload.test.tsx
git commit -m "test: add useProofUpload hook covering the shared upload flow"
```

---

### Task 3: Adopt the hook in `HomePage`

**Files:**
- Modify: `src/pages/HomePage.tsx:101-103` (delete local constants), `:151-156` (delete proof state), `:383-418` (delete both handlers), and the step-3 render block plus the `onSubmit` failure path.

**Interfaces:**
- Consumes: `useProofUpload(pathPrefix: string | null): ProofUpload` from `@/lib/useProofUpload` (Task 2).
- Produces: nothing new. `HomePage` keeps its exported default.

**Behaviour note — one deliberate fix.** Today `onSubmit`'s failure path
(`src/pages/HomePage.tsx:501-503`) clears `proofPath` and `proofFileName` but
never revokes `proofPreviewUrl`, leaking an object URL on every failed submit.
Calling the hook's `reset()` there fixes that. Nothing on screen changes.

- [ ] **Step 1: Confirm the suite is green before touching anything**

Run: `npx playwright test e2e/checkout.spec.ts e2e/storefront.spec.ts --reporter=list`
Expected: PASS — 7 tests.

- [ ] **Step 2: Replace the state and handlers with the hook**

Delete lines 101-103 (`PROOF_BUCKET`, `MAX_PROOF_BYTES`, `ACCEPTED_PROOF_TYPES`), the five proof `useState` calls and `proofInputRef` at 151-156, and both `handleProofFileChange` and `handleRemoveProof` at 383-418. In their place, beside the other hooks in the component body:

```ts
const proof = useProofUpload(submissionToken);
```

Add the import at the top of the file:

```ts
import { useProofUpload } from "@/lib/useProofUpload";
```

- [ ] **Step 3: Repoint every reference**

Rename throughout the file: `proofPath` → `proof.path`, `proofFileName` → `proof.fileName`, `proofPreviewUrl` → `proof.previewUrl`, `proofUploading` → `proof.uploading`, `proofError` → `proof.error`, `proofInputRef` → `proof.inputRef`, `handleProofFileChange` → `proof.handleFileChange`, `handleRemoveProof` → `proof.reset`, and `setProofError(...)` → `proof.setError(...)`.

In the file input's `accept`, the deleted local constant becomes the shared one — add `ACCEPTED_IMAGE_TYPES` to the `@/lib/fileUpload` import and use `accept={ACCEPTED_IMAGE_TYPES.join(",")}`.

In `onSubmit`, replace the failure block's two clears with the hook's reset:

```ts
    if (error || !data) {
      setSubmitError(
        (data as { error?: string } | null)?.error ?? "Something went wrong placing your order. Please try again."
      );
      setSubmissionToken(crypto.randomUUID());
      proof.reset();
      return;
    }
```

- [ ] **Step 4: Verify nothing dangles**

Run: `grep -n "proofPath\|proofFileName\|proofPreviewUrl\|proofUploading\|proofError\|proofInputRef\|MAX_PROOF_BYTES\|ACCEPTED_PROOF_TYPES\|PROOF_BUCKET" src/pages/HomePage.tsx`
Expected: no output.

- [ ] **Step 5: Typecheck, lint and run the suite**

Run: `npx tsc -b && npm run lint && npx playwright test e2e/checkout.spec.ts e2e/storefront.spec.ts --reporter=list`
Expected: no output from the first two; PASS — 7 tests from the third.

- [ ] **Step 6: Commit**

```bash
git add src/pages/HomePage.tsx
git commit -m "refactor: use the shared proof-upload hook in HomePage"
```

---

### Task 4: Adopt the hook in `OrderPage`

**Files:**
- Modify: `src/pages/OrderPage.tsx:105-107` (delete local constants), `:145-160` (delete both blocks of proof state), `:238-273` (delete resubmit handlers), `:299-334` (delete balance handlers), plus the two render blocks and the two submit handlers.

**Interfaces:**
- Consumes: `useProofUpload(pathPrefix: string | null): ProofUpload` from `@/lib/useProofUpload` (Task 2); `ACCEPTED_IMAGE_TYPES` from `@/lib/fileUpload` (Task 1).
- Produces: nothing new.

- [ ] **Step 1: Confirm the suite is green before touching anything**

Run: `npx playwright test e2e/order-tracker.spec.ts --reporter=list`
Expected: PASS — 5 tests.

- [ ] **Step 2: Replace both state blocks with two hook calls**

Delete lines 105-107, the six `resubmit*` declarations at 145-152, and the six `balance*` declarations at 154-160 — but **keep** `resubmitting`/`setResubmitting` and `balanceSubmitting`/`setBalanceSubmitting`, which track the Edge Function call, not the upload. In their place:

```ts
const resubmitProof = useProofUpload(accessToken ?? null);
const balanceProof = useProofUpload(accessToken ?? null);
```

Add the import:

```ts
import { useProofUpload } from "@/lib/useProofUpload";
```

- [ ] **Step 3: Delete the four handlers and repoint their references**

Delete `handleResubmitFileChange` (238-265), `handleRemoveResubmitProof` (267-274), `handleBalanceFileChange` (299-326) and `handleRemoveBalanceProof` (328-335).

Rename throughout: `resubmitPath` → `resubmitProof.path`, `resubmitFileName` → `resubmitProof.fileName`, `resubmitPreviewUrl` → `resubmitProof.previewUrl`, `resubmitUploading` → `resubmitProof.uploading`, `resubmitError` → `resubmitProof.error`, `resubmitInputRef` → `resubmitProof.inputRef`, `handleResubmitFileChange` → `resubmitProof.handleFileChange`, `handleRemoveResubmitProof` → `resubmitProof.reset`, `setResubmitError(...)` → `resubmitProof.setError(...)`. Apply the same mapping to the `balance*` names against `balanceProof`.

Use `accept={ACCEPTED_IMAGE_TYPES.join(",")}` on both file inputs.

- [ ] **Step 4: Fix the two submit handlers**

`handleResubmit`'s success path hand-rolls the same clearing the hook now owns. Replace its tail:

```ts
    if (error || !data) {
      resubmitProof.setError("Couldn't resubmit your payment. Please try again.");
      return;
    }

    resubmitProof.reset();
    setReloadKey((k) => k + 1);
```

Apply the same shape to `handleSubmitBalance`, using `balanceProof` and keeping its own error copy verbatim.

- [ ] **Step 5: Verify nothing dangles**

Run: `grep -n "resubmitPath\|resubmitFileName\|resubmitPreviewUrl\|resubmitUploading\|resubmitError\|resubmitInputRef\|balancePath\|balanceFileName\|balancePreviewUrl\|balanceUploading\|balanceError\|balanceInputRef\|MAX_PROOF_BYTES\|ACCEPTED_PROOF_TYPES\|PROOF_BUCKET" src/pages/OrderPage.tsx`
Expected: no output.

- [ ] **Step 6: Typecheck, lint and run the suite**

Run: `npx tsc -b && npm run lint && npx playwright test e2e/order-tracker.spec.ts --reporter=list`
Expected: no output from the first two; PASS — 5 tests from the third.

- [ ] **Step 7: Commit**

```bash
git add src/pages/OrderPage.tsx
git commit -m "refactor: use the shared proof-upload hook in OrderPage"
```

---

### Task 5: Point `AdminProductsPage` at the shared constants

**Files:**
- Modify: `src/pages/AdminProductsPage.tsx:18-22` (delete local constants), `:160-167` (use the shared validator).

**Interfaces:**
- Consumes: `IMAGE_BUCKET`, `ACCEPTED_IMAGE_TYPES`, `MAX_UPLOAD_BYTES`, `MAX_PRODUCT_PHOTOS`, `validateUploadFile` from `@/lib/fileUpload` (Task 1).
- Produces: nothing new.

**Scope note.** This page keeps its own picker. It takes several files at once,
holds them unuploaded until the form is submitted, supports reordering, and caps
at six — none of which `useProofUpload` does. Sharing the constants and the
predicate is the whole of the overlap; do not extend the hook to fit this.

- [ ] **Step 1: Confirm the suite is green before touching anything**

Run: `npx playwright test e2e/admin-products.spec.ts --reporter=list`
Expected: PASS — 4 tests.

- [ ] **Step 2: Delete the local constants and import the shared ones**

Delete lines 18-22 (`IMAGE_BUCKET`, `MAX_IMAGE_BYTES`, `ACCEPTED_IMAGE_TYPES`, the `MAX_PHOTOS` comment and constant) and add:

```ts
import {
  IMAGE_BUCKET,
  ACCEPTED_IMAGE_TYPES,
  MAX_PRODUCT_PHOTOS,
  validateUploadFile,
} from "@/lib/fileUpload";
```

Rename every `MAX_PHOTOS` in the file to `MAX_PRODUCT_PHOTOS`.

- [ ] **Step 3: Use the shared validator in the picker**

Replace the two `picked.some(...)` guards at 160-167 with one pass that keeps the page's own plural wording:

```ts
    if (picked.some((f) => !ACCEPTED_IMAGE_TYPES.includes(f.type as (typeof ACCEPTED_IMAGE_TYPES)[number]))) {
      setSubmitError("Photos must be JPEG, PNG, or WebP.");
      return;
    }
    const oversized = picked.find((f) => validateUploadFile(f) !== null && ACCEPTED_IMAGE_TYPES.includes(f.type as (typeof ACCEPTED_IMAGE_TYPES)[number]));
    if (oversized) {
      setSubmitError("Each photo must be under 5MB.");
      return;
    }
```

- [ ] **Step 4: Verify nothing dangles**

Run: `grep -n "MAX_IMAGE_BYTES\|MAX_PHOTOS\b" src/pages/AdminProductsPage.tsx`
Expected: no output.

- [ ] **Step 5: Typecheck, lint and run the suite**

Run: `npx tsc -b && npm run lint && npx playwright test e2e/admin-products.spec.ts --reporter=list`
Expected: no output from the first two; PASS — 4 tests from the third.

- [ ] **Step 6: Commit**

```bash
git add src/pages/AdminProductsPage.tsx
git commit -m "refactor: share upload limits with the product photo picker"
```

---

### Task 6: Extract `useShippingSelection`

**Files:**
- Create: `src/lib/useShippingSelection.ts`
- Modify: `src/pages/HomePage.tsx:137-149` (delete ten `useState` calls), `:246-349` (delete four handlers).

**Interfaces:**
- Consumes: `supabase` from `@/lib/supabaseClient`; `LocationOption` and `JneRateOption` types, which move out of `HomePage.tsx` into this module and are re-exported from it.
- Produces:

```ts
export interface LocationOption { code: string; name: string }
export interface JneRateOption { serviceCode: string; serviceName: string; etd: string | null; price: number }

export interface ShippingSelection {
  provinces: LocationOption[] | null;
  cities: LocationOption[] | null;
  districts: LocationOption[] | null;
  selectedProvinceCode: string;
  selectedCityCode: string;
  selectedDistrict: LocationOption | null;
  addressDetail: string;
  setAddressDetail: (value: string) => void;
  locationError: string | null;
  rates: JneRateOption[] | null;
  selectedServiceCode: string | null;
  setSelectedServiceCode: (code: string | null) => void;
  rateLoading: boolean;
  rateError: string | null;
  handleProvinceChange: (code: string) => Promise<void>;
  handleCityChange: (code: string) => Promise<void>;
  handleDistrictChange: (code: string) => void;
  handleGetRate: (items: { variantId: string; quantity: number }[]) => Promise<void>;
}

export function useShippingSelection(): ShippingSelection;
```

`handleGetRate` takes the cart lines as an argument rather than reading cart
state, so the hook stays independent of the cart. The shape is exactly what it
already posts to the `shipping-rates` Edge Function (`src/pages/HomePage.tsx:295-297`).

- [ ] **Step 1: Confirm the suite is green before touching anything**

Run: `npx playwright test --reporter=list`
Expected: PASS — 48 tests.

- [ ] **Step 2: Move the state and handlers into the hook**

Create `src/lib/useShippingSelection.ts` holding the ten `useState` calls from `HomePage.tsx:137-149` and the bodies of `handleProvinceChange` (246-266), `handleCityChange` (267-285), `handleDistrictChange` (286-292) and `handleGetRate` (293-349), moved verbatim. Change only two things: `handleGetRate` takes its `items` array as a parameter instead of deriving it from `quantities`, and the file returns the `ShippingSelection` object above.

- [ ] **Step 3: Call the hook from `HomePage`**

Delete the moved state and handlers from `HomePage.tsx` and add, beside the other hooks:

```ts
const shipping = useShippingSelection();
```

with the import:

```ts
import { useShippingSelection } from "@/lib/useShippingSelection";
```

Repoint every reference to `shipping.<name>`. At the one `handleGetRate()` call site, pass the cart lines the page already builds:

```ts
void shipping.handleGetRate(
  Object.entries(quantities)
    .filter(([, qty]) => qty > 0)
    .map(([variantId, quantity]) => ({ variantId, quantity }))
);
```

- [ ] **Step 4: Verify the page shed the state**

Run: `grep -c "useState" src/pages/HomePage.tsx`
Expected: `17` — down from 27.

- [ ] **Step 5: Typecheck, lint and run the suite**

Run: `npx tsc -b && npm run lint && npx playwright test --reporter=list`
Expected: no output from the first two; PASS — 48 tests from the third.

- [ ] **Step 6: Commit**

```bash
git add src/lib/useShippingSelection.ts src/pages/HomePage.tsx
git commit -m "refactor: extract shipping selection from HomePage into a hook"
```

---

### Task 7: Extract `CheckoutSteps` and `CheckoutNavBar`

**Files:**
- Create: `src/components/checkout/CheckoutSteps.tsx`
- Create: `src/components/checkout/CheckoutNavBar.tsx`
- Modify: `src/pages/HomePage.tsx:522-565` and `:1066-1100`.

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:

```ts
// CheckoutSteps.tsx
export const STEPS = ["Choose items", "Your details", "Review & pay"] as const;
export function CheckoutSteps(props: {
  step: number;
  onStepClick: (step: number) => void;
}): React.ReactElement;

// CheckoutNavBar.tsx
export function CheckoutNavBar(props: {
  step: number;
  cartCount: number;
  subtotal: string;          // already formatted by formatIDR at the call site
  continueDisabled: boolean; // step 1 only
  submitDisabled: boolean;   // step 3 only
  isSubmitting: boolean;
  onBack: () => void;
  onContinue: () => void;
}): React.ReactElement;

The submit button stays a `type="submit"` inside the page's existing `<form>`,
so the nav bar takes no `onSubmit` — the form's own handler still fires.
```

`STEPS` moves out of `HomePage.tsx:116` and is imported back from `CheckoutSteps.tsx` — it is the step indicator's data.

- [ ] **Step 1: Confirm the suite is green before touching anything**

Run: `npx playwright test e2e/checkout.spec.ts e2e/storefront.spec.ts --reporter=list`
Expected: PASS — 7 tests.

- [ ] **Step 2: Move the two render blocks into components**

Create both files, moving the JSX from `HomePage.tsx:522-565` and `:1066-1100` verbatim. Replace every closed-over variable with the prop of the same name from the signatures above. Neither component holds state.

- [ ] **Step 3: Render them from `HomePage`**

```tsx
<CheckoutSteps step={step} onStepClick={setStep} />
```

and, at the foot of the page:

```tsx
<CheckoutNavBar
  step={step}
  cartCount={cartCount}
  subtotal={formatIDR(subtotal)}
  continueDisabled={!hasItems}
  submitDisabled={
    !proof.path || proof.uploading || (fulfilmentMethod === "SHIPPING" && !selectedServiceCode)
  }
  isSubmitting={isSubmitting}
  onBack={() => setStep(step - 1)}
  onContinue={step === 1 ? handleContinueFromItems : () => void handleContinueFromDetails()}
/>
```

- [ ] **Step 4: Typecheck, lint and run the suite**

Run: `npx tsc -b && npm run lint && npx playwright test e2e/checkout.spec.ts e2e/storefront.spec.ts --reporter=list`
Expected: no output from the first two; PASS — 7 tests from the third.

- [ ] **Step 5: Commit**

```bash
git add src/components/checkout/CheckoutSteps.tsx src/components/checkout/CheckoutNavBar.tsx src/pages/HomePage.tsx
git commit -m "refactor: extract checkout progress and nav bar components"
```

---

### Task 8: Extract `ChooseItemsStep`

**Files:**
- Create: `src/components/checkout/ChooseItemsStep.tsx`
- Modify: `src/pages/HomePage.tsx:566-737`.

**Interfaces:**
- Consumes: `ProductRow`, `BatchOption`, `DetailTarget` types, which move from `HomePage.tsx` into this file and are re-exported.
- Produces:

```ts
export function ChooseItemsStep(props: {
  products: ProductRow[];
  batches: BatchOption[];
  activeSource: string;
  onSourceChange: (source: string) => void;
  quantities: Record<string, number>;
  onQuantityChange: (variantId: string, qty: number) => void;
  itemsError: string | null;
  onOpenDetail: (target: DetailTarget) => void;
}): React.ReactElement;
```

- [ ] **Step 1: Confirm the suite is green before touching anything**

Run: `npx playwright test e2e/checkout.spec.ts e2e/storefront.spec.ts --reporter=list`
Expected: PASS — 7 tests.

- [ ] **Step 2: Move the block**

Move `HomePage.tsx:568-736` (the body inside `{step === 1 && (...)}`) into the component verbatim, replacing closed-over variables with the props above. Move the `ProductRow` (`:29`), `BatchOption` (`:82`), `DetailTarget` (`:1107`) and `SelectableItem` (`:72`) declarations with it and export them; `HomePage` imports them back.

Two dependencies travel with those types and are easy to miss: `ProductImageRow` (`:25`), which `ProductRow` refers to, and the `photoUrlsOf` helper (`:39`), which the product cards call. Move both into this file as well — `photoUrlsOf` is only used by this step. Leave `DetailTarget`'s consumer `src/components/product-detail-sheet.tsx` importing it from its new home.

- [ ] **Step 3: Render it from `HomePage`**

```tsx
{step === 1 && (
  <ChooseItemsStep
    products={products ?? []}
    batches={batches ?? []}
    activeSource={activeSource}
    onSourceChange={handleSourceChange}
    quantities={quantities}
    onQuantityChange={setQuantity}
    itemsError={itemsError}
    onOpenDetail={setDetail}
  />
)}
```

- [ ] **Step 4: Typecheck, lint and run the suite**

Run: `npx tsc -b && npm run lint && npx playwright test e2e/checkout.spec.ts e2e/storefront.spec.ts --reporter=list`
Expected: no output from the first two; PASS — 7 tests from the third.

- [ ] **Step 5: Commit**

```bash
git add src/components/checkout/ChooseItemsStep.tsx src/pages/HomePage.tsx
git commit -m "refactor: extract the choose-items checkout step"
```

---

### Task 9: Extract `YourDetailsStep`

**Files:**
- Create: `src/components/checkout/YourDetailsStep.tsx`
- Modify: `src/pages/HomePage.tsx:739-930`.

**Interfaces:**
- Consumes: `ShippingSelection` from `@/lib/useShippingSelection` (Task 6). The whole object is passed as one prop — the step renders every field of it, so splitting it into sixteen props would be noise.
- Produces:

```ts
export function YourDetailsStep(props: {
  register: UseFormRegister<CustomerValues>;
  errors: FieldErrors<CustomerValues>;
  fulfilmentMethod: "PICKUP" | "SHIPPING";
  onFulfilmentMethodChange: (method: "PICKUP" | "SHIPPING") => void;
  shippingAllowed: boolean;
  shipping: ShippingSelection;
  cartItems: { variantId: string; quantity: number }[];
  detailsError: string | null;
}): React.ReactElement;
```

`CustomerValues` moves from `HomePage.tsx:114` into this file and is re-exported, since the schema describes this step's fields.

- [ ] **Step 1: Confirm the suite is green before touching anything**

Run: `npx playwright test e2e/checkout.spec.ts e2e/storefront.spec.ts --reporter=list`
Expected: PASS — 7 tests.

- [ ] **Step 2: Move the block**

Move `HomePage.tsx:740-929` into the component verbatim, replacing closed-over variables with the props above. Move `customerSchema`, `CustomerValues`, `NAME_PATTERN` and `PHONE_PATTERN` (`HomePage.tsx:105-114`) with it and export them; `HomePage` keeps the `useForm` call and imports the schema back.

The step calls `props.shipping.handleGetRate(props.cartItems)` where the page previously called `handleGetRate()`.

- [ ] **Step 3: Render it from `HomePage`**

```tsx
{step === 2 && (
  <YourDetailsStep
    register={register}
    errors={errors}
    fulfilmentMethod={fulfilmentMethod}
    onFulfilmentMethodChange={setFulfilmentMethod}
    shippingAllowed={shippingAllowed}
    shipping={shipping}
    cartItems={Object.entries(quantities)
      .filter(([, qty]) => qty > 0)
      .map(([variantId, quantity]) => ({ variantId, quantity }))}
    detailsError={detailsError}
  />
)}
```

- [ ] **Step 4: Typecheck, lint and run the suite**

Run: `npx tsc -b && npm run lint && npx playwright test e2e/checkout.spec.ts e2e/storefront.spec.ts --reporter=list`
Expected: no output from the first two; PASS — 7 tests from the third.

- [ ] **Step 5: Commit**

```bash
git add src/components/checkout/YourDetailsStep.tsx src/pages/HomePage.tsx
git commit -m "refactor: extract the customer-details checkout step"
```

---

### Task 10: Extract `ReviewPayStep` and confirm the result

**Files:**
- Create: `src/components/checkout/ReviewPayStep.tsx`
- Modify: `src/pages/HomePage.tsx:932-1065`.

**Interfaces:**
- Consumes: `ProofUpload` from `@/lib/useProofUpload` (Task 2); `PaymentSettingsRow`, which moves into this file and is re-exported.
- Produces:

```ts
export function ReviewPayStep(props: {
  activeItems: SelectableItem[];
  quantities: Record<string, number>;
  subtotalCents: number;
  shippingCostCents: number;
  amountDueNowCents: number;
  grandTotalCents: number;
  effectivePaymentType: "DP" | "FULL";
  fulfilmentMethod: "PICKUP" | "SHIPPING";
  paymentSettings: PaymentSettingsRow | null;
  proof: ProofUpload;
  submitError: string | null;
}): React.ReactElement;

`SelectableItem` (`src/pages/HomePage.tsx:72`) moves into
`ChooseItemsStep.tsx` in Task 8 and is imported here from there — it is one
type with one definition, not two.

The DP/FULL selector is **not** part of this step: it lives in step 1's batch
card (`src/pages/HomePage.tsx:703-720`) and moves with Task 8. This step only
renders the resulting `effectivePaymentType`.
```

- [ ] **Step 1: Confirm the suite is green before touching anything**

Run: `npx playwright test --reporter=list`
Expected: PASS — 48 tests.

- [ ] **Step 2: Move the block**

Move `HomePage.tsx:933-1064` into the component verbatim, replacing closed-over variables with the props above. The file input becomes `onChange={props.proof.handleFileChange}` with `ref={props.proof.inputRef}` and `accept={ACCEPTED_IMAGE_TYPES.join(",")}`, and the remove button `onClick={props.proof.reset}`.

- [ ] **Step 3: Render it from `HomePage`**

```tsx
{step === 3 && (
  <ReviewPayStep
    activeItems={activeItems}
    quantities={quantities}
    subtotalCents={subtotalCents}
    shippingCostCents={shippingCostCents}
    amountDueNowCents={amountDueNowCents}
    grandTotalCents={grandTotalCents}
    effectivePaymentType={effectivePaymentType}
    fulfilmentMethod={fulfilmentMethod}
    paymentSettings={paymentSettings}
    proof={proof}
    submitError={submitError}
  />
)}
```

- [ ] **Step 4: Confirm the page actually shrank**

Run: `wc -l src/pages/HomePage.tsx src/components/checkout/*.tsx src/lib/useShippingSelection.ts src/lib/useProofUpload.ts src/lib/fileUpload.ts`
Expected: `HomePage.tsx` under 400 lines, and no other file over 350.

- [ ] **Step 5: Run every check**

Run: `npx tsc -b && npm run lint && npm test && npm run build && npx playwright test --reporter=list`
Expected: no output from the first two; unit tests pass with 11 more than before this plan (77 → 88); a clean build; PASS — 48 Playwright tests.

- [ ] **Step 6: Commit**

```bash
git add src/components/checkout/ReviewPayStep.tsx src/pages/HomePage.tsx
git commit -m "refactor: extract the review-and-pay checkout step"
```

---

## Done when

- `src/pages/HomePage.tsx` is under 400 lines with 17 or fewer `useState` calls.
- `grep -rn "MAX_PROOF_BYTES\|ACCEPTED_PROOF_TYPES\|MAX_IMAGE_BYTES" src/` returns nothing.
- The proof-upload flow exists once, in `src/lib/useProofUpload.ts`.
- `npm test` and `npx playwright test` are both green, with 48 E2E tests still passing and no E2E test edited to accommodate the refactor. **An E2E test that needed changing means behaviour changed — stop and raise it.**
