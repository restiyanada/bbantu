# Test scenarios

Every scenario below runs automatically on each push and pull request
(`.github/workflows/ci.yml`). Nothing here needs to be clicked through by hand.

## How to run them yourself

```bash
npm test              # unit + component tests (Vitest)
npm run test:e2e      # end-to-end browser tests (Playwright)
npx playwright test --ui   # step through them visually
```

## Where to see the report

- **On GitHub** — open the pull request, click **Checks** → **CI**. A green tick
  means every scenario below passed; a red cross opens the failing step with the
  exact assertion that broke.
- **Locally** — after `npm run test:e2e`, run `npx playwright show-report` for a
  browsable report with a screenshot and a DOM snapshot of each failure.

## What the end-to-end tests cover

These drive a real browser against the real app. Supabase is stubbed at the
network level (`e2e/fixtures.ts`), so the tests are deterministic and need no
credentials or live data.

### Storefront and checkout — `storefront.spec.ts`, `checkout.spec.ts`
| Scenario | Expected |
| --- | --- |
| Place a ready-stock order end to end | create-order gets the right items, customer, fulfilment method and proof path; browser lands on the order tracker |
| Same submit token used for proof and order | the idempotency key is present, so a retried submit can't double-order |
| No payment proof uploaded | **Place order** stays disabled; create-order is never called |
| Open pre-order batch exists | the batch and its payment terms are offered on the storefront |
| Review step | shows line items, merchandise subtotal and the bank transfer details |
| Nothing selected on step 1 | **Continue** is disabled |
| Invalid phone / malformed email on step 2 | stays on the details step, never advances |
| Rate-limited create-order | the server's own message is shown, not a generic failure |

### Customer order tracker — `order-tracker.spec.ts`, `find-order.spec.ts`
| Scenario | Expected |
| --- | --- |
| Valid order link | order, items and totals render |
| Wrong / invalid token | clean "Order not found", no console errors |
| Payment rejected | the rejection reason is shown to the customer |
| Ready for pickup | the pickup code is shown |
| Shipped | courier and tracking number are shown |
| Find order by phone + order number | the matching order link is returned |
| Non-matching phone/order pair | says not found, leaks nothing |
| Lookup service failing | reported as a temporary problem, not "not found" |

### Admin sign-in — `admin-login.spec.ts`
| Scenario | Expected |
| --- | --- |
| Correct password | navigates to `/dashboard` (regression guard — this shipped broken once) |
| Wrong password | "Incorrect email or password", stays on the login page |
| Network failure | reads as a connection problem, not a wrong password; the button re-enables |
| Forgot password | sends the reset link and confirms the address |
| Accept-invite link with no session | rejected as invalid or expired |

### Admin access control — `admin-access.spec.ts`
| Scenario | Expected |
| --- | --- |
| Signed-out visitor on any admin route | redirected to the login page |
| Signed-in user who is not an admin | "Not authorized", never the dashboard |
| Following a nav link without the permission | the page itself refuses with a clear message |

### Admin dashboard — `admin-dashboard.spec.ts`
| Scenario | Expected |
| --- | --- |
| Order list and detail drawer | orders list; the drawer shows line items |
| Search | narrows the list to the matching customer |
| Verify a payment | calls verify-payment with the decision, confirms |
| Reject a payment | requires a reason and sends it |
| Admin without *Verify payments* | verify and reject are disabled |
| Prepare a pickup order | calls prepare-pickup, confirms |
| Record tracking on a shipping order | calls record-tracking with the number |
| Server rejects the action | the real server error is shown, not a generic one |

### Admin products — `admin-products.spec.ts`
| Scenario | Expected |
| --- | --- |
| Product list | variants show price, on hand and reserved |
| Empty new-product form submitted | the dialog stays open; nothing is created |
| Admin without *Manage products & batches* | New product and Edit are disabled |
| Products fail to load | an error with a working **Retry**, not a blank page |

### Admin batches — `admin-batches.spec.ts`
| Scenario | Expected |
| --- | --- |
| Batch list | payment terms, items, ordered/MOQ, on hand and reserved |
| Orders exceed the MOQ | the item is flagged "over MOQ" |
| Record a receipt | sends the quantity; reports units received, orders promoted and still waiting |
| Zero or negative receipt quantity | refused before any request goes out |
| Missing permissions | New batch, status and Record receipt are disabled independently |

### Admin audit log — `admin-audit-log.spec.ts`
| Scenario | Expected |
| --- | --- |
| Recent activity | entries render, including guest-triggered ones with no admin actor |
| Search | narrows to the matching actor |
| Admin without *View audit log* | told why; the log is never fetched |
| Audit log fails to load | says so rather than looking like an empty log |

## Not covered here

- **`/scan` (QR camera)** — needs a real camera; the CI browser has none. The
  pickup-code lookup path that the scan feeds into is covered by the dashboard
  and tracker tests.
- **Real Supabase behaviour** — RLS policies, database constraints and Edge
  Function internals are exercised by the unit tests and by deploying, not by
  these browser tests.
