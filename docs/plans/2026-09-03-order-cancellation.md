# Order Cancellation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give admins a way to cancel an order that also releases the inventory it was holding, so a cancelled order stops permanently consuming sellable stock.

**Architecture:** The state machine already models cancellation completely — a `CANCEL` event, a `CANCELLABLE_STATES` guard over eight states, and `CANCELLED` → `REFUND_REQUIRED` → refund-processed. Nothing fires it. This plan wires it up: a new `cancel-order` Edge Function transitions the order and releases its reservation, and the admin dashboard drawer gains a Cancel action. Because no column today records whether an order actually holds a reservation, the plan adds one rather than inferring it from status.

**Tech Stack:** Supabase Edge Functions (Deno), drizzle-orm, Zod, Postgres, React 19 + TypeScript, Vitest, Playwright.

**Spec:** Finding #4 in [`docs/plans/2026-09-03-audit-remediation.md`](2026-09-03-audit-remediation.md). This plan is Stage 1 of the three staged there. Stages 2 and 3 (decrement `on_hand` at fulfilment, plus the backfill) are explicitly **out of scope** and must ship together, later.

## Global Constraints

- **The state machine is the authority on legality.** Never bypass `transitionOrder`; never write `status: "CANCELLED"` directly. `CANCELLABLE_STATES` is `PAYMENT_PENDING, PAYMENT_VERIFIED, RESERVED, AWAITING_STOCK, BALANCE_DUE, READY_FOR_FULFILMENT, READY_FOR_PICKUP, READY_TO_SHIP` — an order that has shipped or been picked up is not cancellable and the machine already refuses it.
- **Releasing stock that was never reserved is worse than the leak.** It inflates availability and causes overselling. Release only against a recorded reservation, never against an inferred one.
- **Cancellation is money-adjacent** — the payment may already be verified. It is permission-gated on `canVerifyPayments` and always audited.
- **Every inventory change writes an `inventory_transactions` row**, as `verify-payment` already does. The ledger is how a leak becomes visible.
- **Copy is verbatim** where this plan gives it.
- `@/` resolves to `src/`. Repo-root `lib/` is Deno-shared pure logic; browser code goes in `src/lib/`.
- Vitest runs `environment: 'node'`; a test needing a DOM opens with `// @vitest-environment jsdom` on line 1.
- Conventional Commits, one commit per task. **Do not push** — the controller pushes.

---

## Why a new column, and not `reservedAt`

The obvious signal for "this order holds a reservation" is `orders.reserved_at`. **It is wrong in both directions**, and a plan that used it would corrupt inventory:

| Path | `reserved_at` | Reservation actually held? |
|---|---|---|
| READY_STOCK, payment verified (`verify-payment:168-176`) | **never set** | **yes** — `tryAllocatePhysicalReservation` must succeed or the call 409s |
| PRE_ORDER, stock available (`verify-payment:201`) | set | yes |
| PRE_ORDER, stock unavailable (`verify-payment:201`) | **set** | **no** — allocation failed, order goes to `AWAITING_STOCK` |

So `reserved_at` means "pre-order queued for allocation", not "inventory reserved". Using it would fail to release READY_STOCK orders (leak persists) and would release stock never taken for `AWAITING_STOCK` orders (**overselling**).

Status is a better proxy — a reservation is held in `BALANCE_DUE`, `READY_FOR_FULFILMENT`, `READY_FOR_PICKUP` and `READY_TO_SHIP` — but `RESERVED` is genuinely ambiguous: a READY_STOCK order reaches it *after* allocation, a PRE_ORDER one *before*. It is transient inside a single transaction and should never be seen at rest, but `CANCELLABLE_STATES` includes it, so a cancel path must answer for it.

The fix is to stop inferring. `orders.stock_reserved_at` is set at the two places that increment `inventory.reserved` and cleared when released. That there is no such column today is precisely why this leak has been invisible.

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `supabase/functions/cancel-order/index.ts` | The admin cancel action: transition, release, audit, notify. |
| `db/migrations/00NN_order_stock_reserved_at.sql` | Adds `orders.stock_reserved_at` and backfills it for existing orders. |
| `src/components/order-cancel-form.tsx` | Reason textarea + confirm, modelled on `payment-rejection-form.tsx`. |
| `lib/reservation.ts` | `releaseReservation` — the pure-ish helper that decrements and writes the ledger. |
| `lib/reservation.test.ts` | Unit tests for it. |
| `e2e/admin-cancel.spec.ts` | E2E coverage of the drawer action. |

**Modified**

| File | Change |
|---|---|
| `db/schema.ts` | `stockReservedAt` column on `orders`. |
| `supabase/functions/verify-payment/index.ts` | Set `stockReservedAt` wherever `reserved` is incremented. |
| `supabase/functions/record-batch-receipt/index.ts` | Same, for promoted orders. |
| `supabase/config.toml` | Register `cancel-order`. |
| `src/pages/AdminDashboardPage.tsx` | Cancel button + handler in the drawer. |

---

### Task 1: Record when a reservation is actually held

**Files:**
- Modify: `db/schema.ts` (the `orders` table, beside `reservedAt`)
- Create: `db/migrations/00NN_order_stock_reserved_at.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: `orders.stockReservedAt` — `timestamp("stock_reserved_at")`, nullable. Non-null means this order currently holds an `inventory.reserved` increment.

- [ ] **Step 1: Add the column to the schema**

In `db/schema.ts`, in the `orders` table beside `reservedAt`:

```ts
    // Non-null while this order holds an inventory.reserved increment.
    // Distinct from reservedAt, which only means "pre-order queued for
    // allocation" and is set even when allocation FAILED (see
    // verify-payment's AWAITING_STOCK path). Releasing stock off reservedAt
    // would free stock that was never taken and cause overselling.
    stockReservedAt: timestamp("stock_reserved_at"),
```

- [ ] **Step 2: Generate the migration, then repair the journal**

Run: `npx drizzle-kit generate`

⚠️ This repo's journal indices have drifted from its filenames, so `generate` names the new migration and snapshot after the **next journal index** and **overwrites an existing snapshot**. Immediately afterwards:

```bash
cp db/migrations/meta/<clobbered>_snapshot.json /tmp/new_snapshot.json
git checkout db/migrations/meta/<clobbered>_snapshot.json
mv /tmp/new_snapshot.json db/migrations/meta/00NN_snapshot.json   # 00NN = next FREE file number
mv db/migrations/<generated>.sql db/migrations/00NN_order_stock_reserved_at.sql
```
Then set the journal's last entry `tag` to `00NN_order_stock_reserved_at`, and verify the chain: the new snapshot's `prevId` must equal the previous snapshot's `id`.

- [ ] **Step 3: Add the backfill to the migration file**

Append below the generated `ALTER TABLE`, with a header comment in this repo's style:

```sql
-- Backfill: an order holds a reservation exactly when verify-payment (or
-- record-batch-receipt, promoting it off the waiting list) incremented
-- inventory.reserved for it and nothing has released it. Nothing releases it
-- today, so every order at or past READY_FOR_FULFILMENT still holds one, as
-- does every BALANCE_DUE order. AWAITING_STOCK orders never got one.
-- PICKED_UP/SHIPPED/COMPLETED keep it too — Stage 2 of the inventory work
-- releases those at fulfilment; this stage must not change their meaning.
UPDATE orders
SET stock_reserved_at = COALESCE(reserved_at, created_at)
WHERE status IN (
  'BALANCE_DUE', 'READY_FOR_FULFILMENT', 'READY_FOR_PICKUP',
  'READY_TO_SHIP', 'PICKED_UP', 'SHIPPED', 'COMPLETED'
);
```

- [ ] **Step 4: Verify no drift remains**

Run: `npx drizzle-kit generate`
Expected: `No schema changes, nothing to migrate 😴`

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc -b && npm run lint`
```bash
git add db/schema.ts db/migrations/
git commit -m "feat: record when an order holds an inventory reservation"
```

---

### Task 2: Set the flag wherever a reservation is taken

**Files:**
- Modify: `supabase/functions/verify-payment/index.ts` (inside `tryAllocatePhysicalReservation`)
- Modify: `supabase/functions/record-batch-receipt/index.ts` (the promotion loop)

**Interfaces:**
- Consumes: `orders.stockReservedAt` (Task 1).
- Produces: the invariant every later task relies on — **`stockReservedAt` is non-null if and only if this order holds an `inventory.reserved` increment.**

- [ ] **Step 1: Set it in verify-payment**

`tryAllocatePhysicalReservation` is the one place that increments `reserved` there. After its `for` loop finishes incrementing (it returns `true` on success), and before `return true`, add:

```ts
        await tx.update(orders).set({ stockReservedAt: new Date() }).where(eq(orders.id, orderId));
```

This covers both call sites — the READY_STOCK path and the PRE_ORDER path — so the flag is set exactly when allocation succeeded and never when it failed.

- [ ] **Step 2: Set it in record-batch-receipt**

In the promotion loop that runs `.set({ reserved: sql\`${inventory.reserved} + ${delta}\` })`, the orders being promoted are `allocateReceivedStock`'s `promoted` list. For each promoted order id, set the flag in the same transaction:

```ts
      for (const orderId of promoted) {
        await tx.update(orders).set({ stockReservedAt: new Date() }).where(eq(orders.id, orderId));
      }
```

- [ ] **Step 3: Verify both writers are covered**

Run: `grep -rn "inventory.reserved} + " supabase/functions/*/index.ts`
Every hit must be in a function that also sets `stockReservedAt`. Expected: exactly two files, both covered.

- [ ] **Step 4: Typecheck, lint, commit**

Run: `npx tsc -b && npm run lint`
```bash
git add supabase/functions/verify-payment/index.ts supabase/functions/record-batch-receipt/index.ts
git commit -m "feat: flag orders that hold an inventory reservation"
```

---

### Task 3: The reservation-release helper

**Files:**
- Create: `lib/reservation.ts`
- Create: `lib/reservation.test.ts`

**Interfaces:**
- Consumes: `inventory`, `inventoryTransactions`, `orderItems` from `db/schema.ts`.
- Produces:

```ts
export interface ReleaseReservationParams {
  orderId: string;
  actorId: string | null;
  reason: string;   // goes verbatim into inventory_transactions.reason
}
/** Decrements inventory.reserved for every line of the order and writes one
 *  ledger row per variant. Returns the per-variant quantities released. */
export async function releaseReservation(
  tx: ReservationTransaction,
  params: ReleaseReservationParams
): Promise<Array<{ variantId: string; quantity: number }>>;
```

The caller decides *whether* to release (by checking `stockReservedAt`); this helper only performs it.

- [ ] **Step 1: Write the failing test**

Create `lib/reservation.test.ts` with a fake tx in the style of `lib/orders.test.ts`, asserting:
1. It decrements `inventory.reserved` by the line quantity for each of an order's items.
2. It writes one `inventory_transactions` row per variant, with a **positive** `quantityDelta` (a release returns stock, the opposite sign to `verify-payment`'s allocation entry) and the `reason` passed in.
3. It returns the per-variant quantities.
4. An order with no items releases nothing and writes no ledger rows.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run lib/reservation.test.ts`
Expected: FAIL — `Failed to resolve import "./reservation"`.

- [ ] **Step 3: Implement it**

Mirror `verify-payment`'s allocation block, inverted: select the order's items, then per item decrement `reserved` and insert a ledger row with `quantityDelta: item.quantity` and the supplied `reason`.

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run lib/reservation.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, lint, commit**

Run: `npx tsc -b && npm run lint`
```bash
git add lib/reservation.ts lib/reservation.test.ts
git commit -m "test: add the reservation-release helper"
```

---

### Task 4: The `cancel-order` Edge Function

**Files:**
- Create: `supabase/functions/cancel-order/index.ts`
- Modify: `supabase/config.toml`

**Interfaces:**
- Consumes: `transitionOrder` (`lib/orders.ts`), `releaseReservation` (Task 3), `requireAdmin` (`_shared/auth.ts`), `orders.stockReservedAt` (Task 1), `notifyOrder` (`_shared/push.ts`).
- Produces: `POST /functions/v1/cancel-order` with body `{ orderId: string (uuid), reason: string (min 1) }`, responding `{ orderId, status: "CANCELLED", stockReleased: boolean }`.

Model the whole file on `supabase/functions/prepare-pickup/index.ts` — same CORS preflight, method guard, Zod parse, `requireAdmin`, `db.transaction`, `errorResponse` tail.

- [ ] **Step 1: Write the function**

Inside one `db.transaction`, in this order:
1. `requireAdmin(req, "canVerifyPayments")` — cancellation can void a verified payment, so it sits with the money permission. (If you later want it split out, that is a new permission column, an `invite-admin` change and a `whoami` change; reusing this one is the smaller correct step today.)
2. Select the order `for update`. 404 if missing.
3. `transitionOrder(tx, { orderId, event: "CANCEL", actorId: admin.id, stockAvailable: true })` — **let the machine reject non-cancellable states**; do not pre-check `CANCELLABLE_STATES` yourself. `OrderTransitionError` must surface as a 409 with its message.
4. **Only if `order.stockReservedAt` is non-null**, call `releaseReservation(tx, { orderId, actorId: admin.id, reason: \`Reservation released — order cancelled: ${input.reason}\` })`, then clear the flag:
   ```ts
   await tx.update(orders).set({ stockReservedAt: null }).where(eq(orders.id, input.orderId));
   ```
   Clearing it is what makes a double-cancel a no-op rather than a double-release.
5. `logAudit` with `action: "order cancelled"`, `before: { status: from }`, `after: { status: "CANCELLED", reason: input.reason, stockReleased }`.
6. **Do NOT queue a customer email.** There is no cancellation template, and adding one is a three-part change outside this plan: the `EmailTemplate` union (`lib/email-queue.ts:3`, currently `ORDER_CONFIRMED | PAYMENT_REJECTED | BALANCE_DUE | READY_FOR_FULFILMENT`), a `renderEmail` case (`_shared/email-templates.ts`), **and** the sender's selection queries (`send-queued-emails/index.ts:26,82,87,99` — `OTHER_TEMPLATES` plus the dedicated per-template queries). Queuing `ORDER_CANCELLED` without all three would insert rows **no query ever selects**, leaving them `QUEUED` forever — silently worse than sending nothing. The admin cancels while talking to the customer; the push notification below is the notification for now. Log the gap in your report.

After the transaction, `notifyOrder(input.orderId, { title: "Order cancelled", body: ... })` — fire-and-forget, never awaited, matching `prepare-pickup`.

- [ ] **Step 2: Register the function**

In `supabase/config.toml`, add:
```toml
[functions.cancel-order]
verify_jwt = true
```
It is admin-only; `requireAdmin` is the real boundary, exactly as the file's existing comments explain.

- [ ] **Step 3: Typecheck and lint**

Run: `npx tsc -b && npm run lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/cancel-order/index.ts supabase/config.toml
git commit -m "feat: add the cancel-order admin action"
```

---

### Task 5: The Cancel action in the admin drawer

**Files:**
- Create: `src/components/order-cancel-form.tsx`
- Modify: `src/pages/AdminDashboardPage.tsx`

**Interfaces:**
- Consumes: the `cancel-order` contract from Task 4.
- Produces: nothing other tasks import.

- [ ] **Step 1: Build the reason form**

Copy the shape of `src/components/payment-rejection-form.tsx` exactly — same `useForm` + `zodResolver` + `Textarea` + `Label`/`RequiredMark` structure. Label it `Cancellation reason`, required, with the validation message `"A cancellation reason is required."` Export it as `OrderCancelForm`.

- [ ] **Step 2: Add the handler**

In `AdminDashboardPage.tsx`, beside `handleReject`, following its exact shape (`setActionError(null)`, `setActioningId`, invoke, clear, `functionErrorMessage` on failure, `toast.success`, `await loadOrders()`):

```ts
  async function handleCancel(orderId: string, reason: string) {
    setActionError(null);
    setActioningId(orderId);
    const { error } = await supabase.functions.invoke("cancel-order", {
      body: { orderId, reason },
    });
    setActioningId(null);
    if (error) {
      setActionError(await functionErrorMessage(error, "Couldn't cancel that order. Please try again."));
      return;
    }
    setCancellingId(null);
    toast.success("Order cancelled");
    await loadOrders();
  }
```
with `const [cancellingId, setCancellingId] = useState<string | null>(null);` beside `rejectingId`.

- [ ] **Step 3: Render it in the drawer**

At the foot of the drawer, in its own `pt-4 border-t` block below the existing actions. Show the button only when the status is cancellable, and gate it the way the Verify/Reject buttons are gated:

```tsx
{CANCELLABLE_STATUSES.has(openOrder.status) && (
  <div className="pt-4 border-t">
    {cancellingId === openOrder.id ? (
      <OrderCancelForm
        submitting={isActioningOpen}
        onSubmit={(values) => handleCancel(openOrder.id, values.reason)}
        onCancel={() => setCancellingId(null)}
      />
    ) : (
      <Button
        size="sm"
        variant="outline"
        disabled={isActioningOpen || !(admin?.canVerifyPayments ?? false)}
        title={admin?.canVerifyPayments ? undefined : "Requires the Verify payments permission"}
        onClick={() => setCancellingId(openOrder.id)}
      >
        Cancel order
      </Button>
    )}
  </div>
)}
```

Define `CANCELLABLE_STATUSES` in this file as a `Set` of the eight names in `lib/order-state-machine.ts`'s `CANCELLABLE_STATES`. **The server is the authority** — this only hides a button the server would refuse anyway.

- [ ] **Step 4: Typecheck and lint**

Run: `npx tsc -b && npm run lint`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/order-cancel-form.tsx src/pages/AdminDashboardPage.tsx
git commit -m "feat: cancel an order from the admin dashboard"
```

---

### Task 6: End-to-end coverage

**Files:**
- Create: `e2e/admin-cancel.spec.ts`

**Interfaces:**
- Consumes: `loginAsAdmin`, `stubFunction`, `adminOrder` from `e2e/fixtures.ts`.

- [ ] **Step 1: Confirm the suite is green first**

Run: `npx playwright test --reporter=line`
Expected: 48 passing.

- [ ] **Step 2: Write the spec**

Follow `e2e/admin-dashboard.spec.ts`'s `openDashboard` helper exactly. Four tests:
1. Cancelling sends the reason — open the drawer on a `READY_FOR_FULFILMENT` order, click **Cancel order**, fill the reason, submit; assert the `cancel-order` request body is `{ orderId: "o1", reason: "..." }` and that "Order cancelled" appears.
2. An empty reason is refused client-side and no request goes out (assert a `called` flag stays `false`, as `e2e/admin-batches.spec.ts` does).
3. An admin without `canVerifyPayments` sees **Cancel order** disabled (pass `{ canVerifyPayments: false }` to `openDashboard`).
4. A server 409 surfaces its real message — stub `cancel-order` with `{ error: "Order is in SHIPPED — nothing to cancel." }` at 409 and assert that exact text renders.

- [ ] **Step 3: Run it**

Run: `npx playwright test e2e/admin-cancel.spec.ts --reporter=line`
Expected: 4 passing.

- [ ] **Step 4: Run everything**

Run: `npx tsc -b && npm run lint && npm test && npm run build && npx playwright test --reporter=line`
Expected: all clean; 52 E2E tests passing (48 + 4).

- [ ] **Step 5: Commit**

```bash
git add e2e/admin-cancel.spec.ts
git commit -m "test: cover cancelling an order from the dashboard"
```

---

## Done when

- An admin can cancel any order in a cancellable state, with a reason, from the drawer.
- Cancelling an order that held a reservation releases it and writes a positive `inventory_transactions` row; cancelling one that did not touches inventory not at all.
- `stockReservedAt` is non-null exactly when a reservation is held, and cancelling clears it, so a repeat cancel cannot double-release.
- Every existing test still passes and none was modified to accommodate this.
- `grep -rn "inventory.reserved} + " supabase/functions/*/index.ts` shows every incrementer also setting `stockReservedAt`.

## Deployment

1. Apply the Task 1 migration via the Supabase SQL editor (this repo's by-hand convention).
2. Sanity-check the backfill:
   ```sql
   SELECT status, count(*), count(stock_reserved_at) AS flagged
   FROM orders GROUP BY status ORDER BY status;
   -- BALANCE_DUE and everything at/after READY_FOR_FULFILMENT: flagged = count
   -- PAYMENT_PENDING / PAYMENT_VERIFIED / AWAITING_STOCK / CANCELLED: flagged = 0
   ```
3. `supabase functions deploy cancel-order verify-payment record-batch-receipt`
4. Deploy the frontend.

**Order matters:** the migration must land before the redeployed `verify-payment`, which writes the new column.

## Explicitly out of scope

Stage 2 (decrement `on_hand` and release `reserved` at fulfilment) and Stage 3 (the reconciliation backfill). Until those ship, `on_hand` remains "total ever received" and orders that complete normally keep holding their reservation. **This plan does not fix that** — it stops cancellations leaking, which is the part with no workaround today.
