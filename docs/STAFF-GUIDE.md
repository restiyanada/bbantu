# Staff Guide — Daily Operations

For the people handling orders day to day: checking payments, getting orders
ready, and handing them over. Find your situation below and follow the steps.

Owner-only work — adding products, creating batches, receiving stock, managing
admin accounts — is not in this guide.

---

## Signing in

Go to **/admin/login**, enter your email and password.

You stay signed in, so you shouldn't have to do this daily. If you're asked
again, just sign in — nothing is wrong.

- **"Incorrect email or password"** — check for typos and try again.
- **"Taking too long — check your connection"** — that's the network, not your
  password. Check your signal and retry.
- **Forgotten it?** Click **Forgot password?**, enter your email, and follow the
  link that arrives.

**Add the site to your phone's home screen.** It then opens like a normal app and
keeps you signed in.

---

## The Orders screen

This is your main screen. Three tiles across the top tell you what needs doing:

| Tile | What it means |
|---|---|
| **Needs payment review** | Customers have paid and are waiting for you to check |
| **Ready to fulfil** | Payment confirmed — these need packing |
| **Completed** | Handed over or shipped. Nothing to do |

Below that is the order list. To find one order, type into **Search by customer,
phone, or order number…** — any of the three works. The two dropdowns filter by
status and by pickup/shipping.

Click **Open** on any order to see everything about it: customer details, what
they bought, what they paid, and the buttons for what to do next.

**Rule of thumb: work the tiles left to right.** Clear "Needs payment review"
first, then "Ready to fulfil".

---

# Everyday tasks

## A customer sent payment proof — check it

1. **Orders** → click **Open** on the order (it'll be counted in *Needs payment
   review*)
2. Look at the **Payment** section. Compare the uploaded proof against
   **Merchandise total**. Tap the image to enlarge it.
3. Money is correct and it's really in the account → **Verify**
4. Something's wrong → **Reject**, type the reason, then **Reject payment**

You'll see *"Payment verified"* or *"Payment rejected"*.

**Write rejection reasons the customer can act on.** They see this text. "Transfer
amount is 145.000 but the order total is 165.000 — please send the difference"
tells them what to do. "Wrong" doesn't. They can upload new proof afterwards
without you doing anything.

⚠️ **Check the money actually arrived in the bank account, not just that a
screenshot exists.** Screenshots can be edited.

---

## An order is paid — get it ready

1. **Orders** → **Open** the order (counted in *Ready to fulfil*)
2. Pack the items listed under **Items**
3. Click **Prepare for pickup** — or **Prepare for shipment** if they chose
   delivery

You'll see *"Order marked ready"*.

**For pickup:** a 6-character code is created and sent to the customer. They show
it when collecting. You don't need to write it down.

**For shipping:** the order moves on to await a tracking number.

---

## A customer arrives to collect

1. **Scan** in the menu
2. Point the camera at their code
3. Check the name and items on screen match the person in front of you
4. **Confirm pickup**

### If the camera won't work

Under **Camera not working?** there are two ways in:

- **Paste pickup code** — type the 6 characters and press **Look up**. Case
  doesn't matter; it capitalises as you type.
- **Customer phone number** — if they lost the code entirely. If they have
  several orders you'll get **Select the right order** — pick the right one.

### What the screen tells you

| You see | Do this |
|---|---|
| Order details + **Confirm pickup** button | Hand it over, tap the button |
| *"Pickup confirmed."* | Done |
| Already picked up | It was collected before. Check with the customer before handing over anything |
| Not eligible for pickup | Not ready yet. Check the Orders screen for its status |

---

## A shipping order is packed — add the tracking number

1. **Orders** → **Open** the order
2. **Record tracking** in the **Shipment** section
3. Type the courier's tracking number → **Mark shipped**

You'll see *"Tracking recorded"*. The customer can now track it themselves.

**Need the address label?** **Print label** on the order, or **Bulk print labels**
to do several at once.

---

## Cancelling an order

1. **Orders** → **Open** the order
2. **Cancel order**
3. Type the reason → confirm

You'll see *"Order cancelled"*.

⚠️ **The customer sees the reason you type, word for word.** Write it for them,
not as an internal note.

Cancelling also returns the items to available stock automatically — you don't
need to adjust anything.

**If they already paid, the refund is manual.** The app does not track refunds
owed. Note it down and send the money back yourself.

You can't cancel an order that's already been picked up or shipped — the button
won't be there.

---

# When something looks wrong

**A button is greyed out**
Hover over it and it'll tell you which permission you're missing. Ask the owner
to grant it.

**"Not enough stock available"**
Someone else's order took the last one, or stock hasn't been received yet. Tell
the owner — don't verify the payment.

**The customer lost their order link**
Send them to **/orders/find**. They enter their phone number and order number and
get the link back.

**A customer says they paid but nothing shows**
Search their phone number in the Orders screen. If the order is there but shows
*payment pending*, they may not have finished uploading the proof — ask them to
open their link and upload again.

**Payment status looks wrong on the scan screen**
It shows the most recent payment. An order that was rejected once and paid again
shows the newest attempt.

**Anything you're unsure about — stop and ask the owner.** Verifying a payment or
confirming a pickup is hard to undo. Waiting five minutes costs nothing.

---

# Order statuses

You'll see these on the Orders screen.

| Status | Meaning | Your move |
|---|---|---|
| `PAYMENT_PENDING` | Waiting for payment or proof | Wait |
| `PAYMENT_VERIFIED` | You approved the payment | None — moves on by itself |
| `RESERVED` | Stock set aside | None |
| `AWAITING_STOCK` | Pre-order, stock not in yet | Wait for the owner to receive stock |
| `BALANCE_DUE` | Deposit paid, rest still owed | Wait for the balance payment |
| `READY_FOR_FULFILMENT` | Paid in full — needs packing | **Pack it** |
| `READY_FOR_PICKUP` | Waiting for the customer | Wait for them to arrive |
| `READY_TO_SHIP` | Packed, needs a tracking number | **Add tracking** |
| `PICKED_UP` | Collected | Done |
| `SHIPPED` | Sent | Done |
| `COMPLETED` | Finished | Done |
| `CANCELLED` | Cancelled | Refund manually if they paid |

---

# Quick reference

| Situation | Where | Button |
|---|---|---|
| Payment proof arrived | Orders → Open | **Verify** or **Reject** |
| Paid order needs packing | Orders → Open | **Prepare for pickup / shipment** |
| Customer collecting | Scan | **Confirm pickup** |
| No camera | Scan → Camera not working? | **Look up** |
| Parcel posted | Orders → Open | **Record tracking** → **Mark shipped** |
| Need a label | Orders → Open | **Print label** |
| Order must be cancelled | Orders → Open | **Cancel order** |
| Customer lost their link | Send them to `/orders/find` | — |
