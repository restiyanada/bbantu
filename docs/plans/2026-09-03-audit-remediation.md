# Audit Remediation Plan

Findings from a repo-wide bug audit (2026-09-03) plus the six duplication items
from the preceding duplication scan, ranked by criticality. Effort is one
engineer's working time including tests.

**Effort key:** XS ≈ 15 min · S ≈ 1 hr · M ≈ half a day · L ≈ 1–2 days

| # | Finding | Severity | Effort | Status |
|---|---|---|---|---|
| 1 | Balance payment omits shipping cost | **Critical** | S | ✅ done (cf0420b) |
| 2 | No CHECK constraint on `payments.amount` | **Critical** | XS | ✅ done (cf0420b) |
| 3 | Access-token hashing duplicated 5× | Important | M | |
| 4 | `reserved` inventory only ever increments | Important | L | ⏳ Stage 1 done (cancellation + release); Stages 2-3 open |
| 5 | Pickup-code collision retry cannot work | Important | S | ✅ done (d0d7c42) |
| 6 | Three guest endpoints unrate-limited | Important | S | ✅ done (d0d7c42) |
| 7 | `resubmit-payment` / `submit-balance-payment` 65% duplicate | Important | M | |
| 8 | `scan-pickup` picks an arbitrary payment row | Minor | XS | ✅ done (d0d7c42) |
| 9 | Status groupings duplicated, not tied to the enum | Minor | S | |
| 10 | Audit-log dates use the browser locale | Minor | XS | ✅ done (d0d7c42) |
| 11 | `weightGrams` stores billable, not actual, weight | Minor | XS | |
| 12 | `fetchWithTimeout` duplicated — **no action** | — | — | |

---

## 1. Balance payment omits the shipping cost — CRITICAL, effort S

**Where:** `supabase/functions/submit-balance-payment/index.ts:78`

```ts
const balanceAmount = (Number(order.merchandiseSubtotal) - Number(order.amountPaid)).toFixed(2);
```

**The bug.** An order's total is `merchandiseSubtotal + shippingCost`. This line
omits shipping. It only bites the **deposit + shipping** combination, which is
reachable: a batch's `allowedPaymentTypes` and `allowedFulfilmentMethods` are
validated independently (`create-order/index.ts:121,124`), so a pre-order batch
can offer DP and SHIPPING together, and DP orders always route through
`BALANCE_DUE` (`lib/order-state-machine.ts:86,92`).

Walk it through for subtotal 200,000 and shipping 30,000:

| Step | Value |
|---|---|
| Deposit paid at checkout (`create-order:240-241`) | 100,000 + 30,000 = **130,000** |
| `amountPaid` after verification (`verify-payment:132`) | 130,000 |
| Balance the customer is SHOWN (`OrderPage.tsx:269`) | (200,000 + 30,000) − 130,000 = **100,000** ✓ |
| Balance the backend RECORDS (`:78`) | 200,000 − 130,000 = **70,000** ✗ |

The customer is shown the right number and transfers 100,000. The system
records a 70,000 payment. Final `amountPaid` = 200,000 against a 230,000 total,
so **every such order permanently under-records revenue by exactly the shipping
cost**, and the tracker keeps showing an outstanding balance for an order that
is fully paid.

**It can also go negative.** When shipping exceeds half the merchandise —
subtotal 100,000, shipping 60,000 — the line yields 100,000 − 110,000 =
**−10,000**, and a negative payment row is inserted. Nothing stops it (see #2).

**Fix:**
```ts
const total = Number(order.merchandiseSubtotal) + Number(order.shippingCost ?? 0);
const balanceAmount = (total - Number(order.amountPaid)).toFixed(2);
```
This is the same expression `OrderPage.tsx:269` already uses; the two should
agree by construction.

**Also needed:** a unit test in `lib/` covering the four combinations
(DP/FULL × PICKUP/SHIPPING), and a data check on production for existing
DP+SHIPPING orders whose `amountPaid` is short.

---

## 2. No CHECK constraint on `payments.amount` — CRITICAL, effort XS

**Where:** `db/schema.ts:359`

`amount` is `numeric(12,2) NOT NULL` with no lower bound, which is why #1 can
insert a negative payment silently. Add `CHECK (amount > 0)`. The constraint is
what makes #1 fail loudly rather than corrupt the ledger, so land it in the same
change.

Mind the repo's migration footgun documented in the README — generate the
migration, then verify the journal and snapshot numbering before committing.

---

## 3. Access-token hashing duplicated 5× — IMPORTANT, effort M

**Where:**
```
create-order/index.ts:266            inline
get-order/index.ts:74                inline
resubmit-payment/index.ts:11         const hashAccessToken
submit-balance-payment/index.ts:11   const hashAccessToken   (byte-identical)
push-subscribe/index.ts:10           const hashAccessToken   (byte-identical)
```

All five compute `encode(digest(token, 'sha256'), 'hex')`. This is the guest
authentication boundary — what makes an order link unforgeable. Changing the
algorithm in four of five places would leave some links silently unresolvable,
with no failing test to catch it.

**Fix:** one `hashAccessToken` in `supabase/functions/_shared/tokens.ts` beside
`generateAccessToken`, imported by all five. Effort is M rather than S because
each function needs redeploying and the guest paths retesting.

---

## 4. `reserved` inventory only ever increments — IMPORTANT, effort L

**Where:** `verify-payment/index.ts:61` and `record-batch-receipt/index.ts:116`
are the only writers, and both `+=`. Nothing anywhere decrements `reserved`, and
nothing decrements `onHand`.

**What this means.** `available = onHand − reserved` is arithmetically right for
gating checkout, so there is no live over-selling bug. But the two columns are
cumulative counters, not stock levels:
- `onHand` = everything ever received, never reduced when goods leave.
- `reserved` = everything ever committed, never released at pickup or shipping.

Consequences:
1. The admin UI presents these as physical stock ("on hand: 50 · reserved: 47").
   An owner reads that as "50 on the shelf, 47 awaiting handover". After a year
   of trading it means "received 50 ever, sold 47 ever" — unreconcilable against
   a physical count.
2. **There is no cancellation path anywhere in the app** — no Edge Function
   writes `CANCELLED`. Any order cancelled by hand in SQL leaks its reservation
   permanently, silently shrinking available stock.

**This needs a decision before code.** Either (a) keep cumulative counters and
rename/relabel them honestly, adding a separate physical-count view; or (b) move
to true stock levels — decrement `onHand` at fulfilment, release `reserved` on
cancel — which needs a cancellation flow and a backfill. L covers (b); (a) is M.

---

## 5. Pickup-code collision retry cannot work — IMPORTANT, effort S

**Where:** `supabase/functions/prepare-pickup/index.ts:75-85`

```ts
for (let attempt = 0; attempt < 5; attempt++) {
  token = generatePickupCode();
  try { await tx.insert(pickupTokens).values({ orderId: input.orderId, token }); break; }
  catch (err) { if (isUniqueViolation(err) && attempt < 4) continue; throw err; }
}
```

In Postgres, **any failed statement aborts the enclosing transaction block**
unless a SAVEPOINT was taken. After the first unique violation every later
statement fails with `current transaction is aborted`. So the retry loop cannot
retry: a collision surfaces as a confusing 500, not a second code.

The code space is 32^6 ≈ 1.07 billion, so collisions are vanishingly rare — the
problem is that five attempts' worth of apparent safety does not exist.

**Fix:** wrap each attempt in a nested `tx.transaction()` (drizzle emits a
SAVEPOINT), or generate the code and check for a collision before inserting.
Add a test that forces a collision.

*Credit where due:* `CODE_ALPHABET` is 32 characters and 256 % 32 == 0, so the
`b % length` generator has **no modulo bias**. That part is correct.

---

## 6. Three guest endpoints are unrate-limited — IMPORTANT, effort S

Five guest-facing functions call `enforceRateLimit`. These three do not:

| Function | `verify_jwt` | Notes |
|---|---|---|
| `resubmit-payment` | false | accepts a file reference, writes a payment row |
| `submit-balance-payment` | false | same |
| `push-unsubscribe` | — | writes |

All three require a valid access token, so this is not open enumeration — but it
is inconsistent with the other five, and one leaked order link allows unlimited
hammering. Add `enforceRateLimit(req, "<name>")` to each.

(`cleanup-payment-proofs` and `send-queued-emails` also lack limits and are
**fine** — they are cron-only behind the platform's default `verify_jwt = true`,
as `supabase/config.toml:22-25` explains.)

---

## 7. `resubmit-payment` / `submit-balance-payment` 65% duplicate — IMPORTANT, effort M

Only 40 of ~107 lines differ. Both: validate the guest token, load the order,
confirm the proof object exists in storage, reject if a PENDING payment already
exists, insert a payment row, write an audit entry, notify admins. They differ
only in the status they require and the amount they record.

**Fix:** one `submitGuestPayment` helper in `_shared/`, parameterised by
required status and amount. Note #1's fix lands inside this shared path, so
sequence it **after** #1 — do not merge them first and fix the money bug inside a
new abstraction.

---

## 8. `scan-pickup` picks an arbitrary payment row — MINOR, effort XS

**Where:** `supabase/functions/scan-pickup/index.ts:98`

```ts
const [payment] = await tx.select().from(payments).where(eq(payments.orderId, order.id));
```

No `ORDER BY`. An order with several payments (a rejected attempt, or DP plus
balance) returns whichever row Postgres yields first, so the `paymentStatus`
shown on the scan screen may be a stale REJECTED row. Every other call site
already orders correctly (`get-order:101`, `list-orders:82-85`,
`submit-balance-payment:76`). Add `.orderBy(desc(payments.submittedAt)).limit(1)`.

---

## 9. Status groupings duplicated and untied to the enum — MINOR, effort S

`src/lib/utils.ts:51-60` groups statuses into badge colours;
`src/pages/AdminDashboardPage.tsx:287-290` groups the same statuses into stat
buckets. Both hand-list `READY_FOR_FULFILMENT / READY_FOR_PICKUP /
READY_TO_SHIP`.

Adding a 14th status to `orderStatusEnum` breaks no build — it silently renders
grey and counts toward nothing. **Fix:** one exhaustive `Record<OrderStatus, …>`
map so TypeScript fails when a status is added without a home.

---

## 10. Audit-log dates use the browser locale — MINOR, effort XS

`src/pages/AdminAuditLogPage.tsx:53` calls `toLocaleString()` with no locale,
while `AdminBatchesPage.tsx:463` and `OrderPage.tsx:423` force `"id-ID"`. Audit
timestamps therefore render differently per admin's browser. Pass `"id-ID"`.

---

## 11. `weightGrams` stores billable, not actual, weight — MINOR, effort XS

`create-order/index.ts:235` stores `weightKg * 1000`, where `weightKg` is the
courier's rounded-up billable weight. The shipment record therefore reports a
weight the parcel does not have. Harmless today (nothing reads it back for
anything but display) but wrong if it is ever used for reconciliation. Either
store the true gram total or rename the column to `billable_weight_grams`.

---

## 12. `fetchWithTimeout` duplicated — NO ACTION

`src/lib/fetchWithTimeout.ts` and
`supabase/functions/_shared/fetch-with-timeout.ts` are near-identical **by
necessity** — one is browser, one is Deno, with separate build systems and no
shared module graph. Merging them would break the build. Leave them; the
duplication is the correct trade.

---

## Suggested sequencing

1. **#1 + #2 together** — the money bug and the constraint that would have
   caught it. Ship first, alone, and check production data for affected orders.
2. **#5, #6, #8, #10** — small, independent, low-risk. One batch.
3. **#3, then #7** — dedupe the hash, then the two payment functions, in that
   order (#7's shared path should already contain #1's fix).
4. **#9, #11** — cleanup.
5. **#4 last** — it needs your decision on the inventory model before any code.

## Not in this plan

The known object-URL leak in `useProofUpload` (a second file picked before the
first is removed) is **pre-existing** and was deliberately preserved during the
checkout refactor rather than changed silently. It belongs in a UI pass, not here.

---

## Found later, during the cancellation work (2026-09-03)

### 13. Cancelling a paid order leaves no refund trail — IMPORTANT, effort M

Surfaced by the final review of the cancellation feature. An admin can now
cancel a `READY_FOR_FULFILMENT` order with money already collected, and the only
record that a refund is owed is an audit row.

`lib/order-state-machine.ts` models the rest of the flow — `CANCELLED` →
`REFUND_REQUIRED` via `MARK_REFUND_REQUIRED`, then `REFUND_PROCESSED` — and
**nothing fires either event** (`grep` finds them only in the machine's own
definition). So the states exist, are reachable in principle, and are dead in
practice, exactly as `CANCEL` itself was before this work.

Cancellation Stage 1 deliberately did not scope this: it stops the inventory
leak, which had no workaround. Refunds have one — the owner knows they owe the
money. But the moment cancellation is used on paid orders, the shop needs
somewhere to see "refund owed" that is not the audit log.

### 14. The drawer's inline forms survive an order switch — MINOR, effort S

`rejectingId`, `trackingEntryId` and `cancellingId` in
`src/pages/AdminDashboardPage.tsx` are not reset when the drawer opens a
different order.

**Not as bad as it first looks** — my initial description of this was wrong and
the final review corrected it. Every inline form is gated on
`id === openOrder.id`, so switching orders *hides* the stale form; it cannot
render against, or submit against, an order other than the one on screen. The
real symptom is a form reappearing already-open when you return to the original
order. Cosmetic. Pre-existing — cancellation replicated the established pattern
rather than introducing it.

Fix: clear all three in an effect keyed on the open order id.
