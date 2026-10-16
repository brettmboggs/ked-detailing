# Stripe Connect plan

How card payments come into KED, set up from day one as a platform, so Jacob is
the first business on it and every later detailer joins the same way.
Written 2026-10-15. Stripe's API moves, so check the linked docs before
building each step.

## The shape

- **Brett owns a Stripe platform account** with Connect on. It holds no
  customer money, only Brett's platform fees.
- **Jacob gets a connected account** under the business's own name, EIN and
  Commerce Bank account. Payouts go straight to him. He can log in to the
  full Stripe Dashboard and see his own payments, refunds and disputes.
- **Every payment is a direct charge on Jacob's account.** It shows his
  business on the customer's card statement. Stripe takes its fee from him,
  and any platform fee is taken out automatically on top.

### Account settings (Accounts v2)

Stripe now steers new platforms to the Accounts v2 API instead of the old
Standard/Express/Custom types ([connected account
configuration](https://docs.stripe.com/connect/accounts-v2/connected-account-configuration)).
Create Jacob's account with:

| Setting | Value | Why |
| --- | --- | --- |
| Configuration | `merchant`, with `card_payments` requested | He takes payments |
| `dashboard` | `full` | He sees his own money without asking Brett. Same as the old "Standard" type |
| `defaults.responsibilities.fees_collector` | `stripe` | Stripe bills its processing fee to him directly. Any `application_fee_amount` is only Brett's cut |
| `defaults.responsibilities.losses_collector` | `stripe` | Stripe, not Brett, covers a negative balance (a chargeback after a payout). Brett shouldn't carry risk on other people's businesses |

These two responsibilities **can't be changed after the account is made**,
so settle them before creating it. With `full` Dashboard and Stripe-owned
losses, Stripe collects the identity checks itself (`requirements_collector`
works out to `stripe`).

**Cost to Brett:** none. Connect is "included at no additional charge" when
Stripe handles pricing for the connected accounts
([stripe.com/pricing](https://stripe.com/pricing)). Express and Custom
accounts cost extra; this setup uses neither.

## What Jacob pays per payment (Stripe's US list rates, 2026-10-15)

| How the customer pays | Rate |
| --- | --- |
| Card online (the invoice's pay link) | 2.9% + 30¢ |
| Card in person, Tap to Pay on iPhone | 2.7% + 5¢, plus 10¢ for Tap to Pay = 2.7% + 15¢ |
| Bank transfer (ACH), online | 0.8%, capped at $5 |

On a $300 detail that's $9.00 online, $8.25 tapped, $2.40 by bank. ACH is
worth offering on coatings and paint correction.

## Brett's fee

`application_fee_amount` on each PaymentIntent / Checkout Session, computed by
the API from a setting. Store it as `{ percentBps, capCents }` in the
business's settings so each future detailer can be on their own rate.
**Default 0 until Brett picks Jacob's founding number.** Stripe charges
nothing on the application fee itself.

Alternative: a flat monthly subscription billed to Jacob's account (Accounts v2
can give the same account a `customer` configuration). A per-payment fee is
less to run and scales with his revenue; a flat fee is easier to explain.
Brett's call.

## Build steps

Code lives in `api/`. Keys are Worker secrets, never in `wrangler.jsonc`.

1. **Platform account (Brett).** Sign up at stripe.com, turn on Connect, fill
   in the platform profile (SaaS, US, sellers are detailing businesses).
   Decide first whether it's in his own name or an LLC for the platform:
   changing the legal entity on a live Stripe account later is painful. Turn
   on ACH Direct Debit and Apple Pay under payment methods.
2. **Secrets.** `STRIPE_SECRET_KEY` (restricted key: PaymentIntents, Checkout,
   Accounts, Account Links, Terminal) and `STRIPE_WEBHOOK_SECRET`. Test-mode
   pair in `.dev.vars` for the test Worker.
3. **Onboarding.** `POST /v1/stripe/connect` (owner only) creates the
   account with the settings above and returns an Account Link URL. Store
   `stripe_account_id` on the business (new migration, a single-row
   `business_settings` key for now; tag `TENANT:`). The admin's Settings gets
   a "Card payments" block: not started / waiting on Stripe / on, read from
   the account's requirements. Jacob opens the link on his phone; returning
   with anything unfinished makes a fresh link.
4. **Online invoices.** Fill in `startCheckout` in `api/src/invoices.ts`: a
   Checkout Session made with the `Stripe-Account: <jacob>` header, one line
   for the invoice balance, `payment_method_types` card + us_bank_account,
   `application_fee_amount`, `metadata.invoice` = invoice id, success and
   cancel URLs back to `/pay/?i=`. Flip `payOnline` to true when the account
   can take charges.
5. **Webhook.** `POST /v1/stripe/webhook`, signature-checked, as a **Connect**
   event destination (events from connected accounts). Handle:
   - `checkout.session.completed` and `checkout.session.async_payment_succeeded`
     (ACH settles days later): call `recordInvoicePayment` with
     `depositToId: 'stripe'`, the gross amount, and the payment's balance
     transaction fee booked to the `fees` account in the same entry. Key it
     on the PaymentIntent id so a retried webhook can't record twice.
   - `checkout.session.async_payment_failed`: alert Jacob, nothing booked.
   - `charge.refunded`: a reversal entry.
   - `charge.dispute.created`: push alert, follow-up on his Today list.
6. **Payouts in the books.** Already handled: the bank import's starter rule
   treats `STRIPE TRANSFER` deposits as a transfer out of the `stripe`
   balance account (`packages/books/src/merchant.ts`). Check it against his
   first real payout line from Commerce.
7. **Tap to Pay on iPhone (app repo).** Request Apple's Tap to Pay entitlement
   for `com.brettboggs.ked` **now**; development first, distribution after
   testing ([Stripe's steps](https://docs.stripe.com/terminal/payments/setup-reader/tap-to-pay?platform=ios)).
   Use the Stripe Terminal React Native SDK. The API adds
   `POST /v1/stripe/terminal/connection-token` and a Location, both made on
   Jacob's account with the `Stripe-Account` header, and
   `POST /v1/jobs/:id/charge` to create the in-person PaymentIntent with the
   same fee and metadata. Apple requires the "How to Tap" screen
   (`ProximityReaderDiscovery`, iOS 18+) before review. Needs iPhone XS or later.
   The same webhook records it, from `payment_intent.succeeded` with
   `metadata.source = 'tap'`.
8. **Tests.** Stripe's test mode plus `stripe listen --forward-connect-to`
   against the local Worker. Add API tests that post signed sample events and
   check the ledger entry, the duplicate guard and the refund.
9. **Go live.** Swap to live keys, make Jacob's real account, one $1 charge
   on his own card each way (link and tap), refund it, check the books.

## Later detailers

The same flow, run per business: their own connected account, their own fee
setting. Nothing above assumes Knock Em' Down except the single settings row,
tagged `TENANT:`. Add a line to `docs/multi-tenant.md` when this lands.

## What waits on Jacob

Only step 9's account form (about 15 minutes, with his EIN, his date of birth
and home address for Stripe's ID check, and the Commerce routing and account
numbers) and an iPhone XS or newer for Tap to Pay. Everything else Brett can
build in test mode now.
