# CoTreasury

**A shared treasury where groups of people or collectives manage money together.**

CoTreasury helps groups contribute money, agree on spending, and track every payment in one shared place. An AI Treasurer helps members understand the finances and prepare requests. Group rules determine who can approve payments, PayPal processes them, and a tamper-evident activity log helps everyone check what happened.

**AI explains. People approve. PayPal moves the money. The ledger keeps the record.**

Built with PayPal APIs, Claude, and AG Grid for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/).

**Live sandbox demo:** https://cotreasury.up.railway.app

---

## Problem

When a group pools money (founders, friends planning a trip, a household, a club), it usually depends on one
person to keep track of it and pay for things. The rest of the group sees only what that person tells them:
there are no agreed spending rules and no shared record everyone can check.

## Solution

CoTreasury puts a governed treasury on top of a PayPal business account:

- **The group sets the rules.** How many approvals a payout needs (by amount), fixed or random reviewers,
  extra approval for new recipients and self-payments, a member limit, and what happens when someone leaves
  or the group closes. Changing a rule needs the group’s approval too.
- **PayPal moves the money.** Contributions go through PayPal Checkout. Payouts go out through PayPal Payouts
  only after the rules are met.
- **An AI Treasurer helps.** Members ask questions in plain language; the AI checks the real numbers and drafts
  contributions and payout requests. It can’t approve or move money.
- **Everyone sees the same record.** A shared ledger of PayPal-confirmed payments, a sealed (hash-chained)
  activity log, and an alert when money moves in PayPal outside CoTreasury.

## Who it’s for

Groups that manage money together: startup founders sharing a pre-launch budget, friends saving for a trip,
households, clubs, scholarship funds and community groups.

---

## Try it (for judges)

Everything runs in the **PayPal sandbox**. No real money moves.

### 1. Open a demo treasury

| Demo | What it shows |
| --- | --- |
| **Brightline Labs — Founders’ Fund 🚀** | A startup’s shared budget. All three founders approve big payouts. Leaving refunds your unspent share. |
| **Girls’ Trip to Lisbon 🇵🇹** | Payouts are reviewed by a **random, hidden panel** of members, revealed after the vote. |
| **💍 The Johnsons Household** | A couple’s shared household money with fixed approvers. |

Each browser gets its **own private copy** of a demo, so your actions don’t affect other judges.

### 2. Switch between members

Use **Viewing as** (top right) to act as different people: make a request as one member, then switch to the
approvers to vote on it. Only demos allow switching; a treasury you create is private to its members.

### 3. Things to try

1. **Add funds:** click **Add funds** and pay with the sandbox buyer account below.
2. **Ask the AI Treasurer:** click **Ask** and try *“Can we afford a $1,400 deposit?”* or *“I want to request a payout.”*
3. **Request a payout and approve it:** once enough approvers say yes, PayPal Payouts sends it to an email or phone number.
4. **Ledger:** every payment in and out with its PayPal reference. Click a row for the receipt.
5. **Outside activity:** money moved directly in PayPal (like the $350 in Brightline) shows in **red** with an alert.
6. **Activity log:** every action in order. Press **Check integrity** to confirm no past entry was changed.
7. **Leave the group** (Settings): your refund is paid only if the group approves it.
8. **Create your own treasury** from the home page and invite people with an invite link.

### Sandbox test credentials

PayPal sandbox **buyer (personal) account**, for **Add funds**:

```
Email:    sb-68prz53298121@personal.example.com
Password: O600Ua1/
```

If PayPal says the account is “associated with the merchant”, you’re signed in to a business account.
Log out in the PayPal window (or use a private window) and sign in with the buyer account above.

---

## How PayPal is used

PayPal processes every payment. CoTreasury decides **when to ask** PayPal to pay, and records what PayPal confirms.

| PayPal capability | Used for |
| --- | --- |
| **Orders v2** (create, capture) + **JavaScript SDK v6** checkout | Member contributions (Add funds) |
| **Payouts** (batch create, item status) | Approved payouts, leaving refunds and closing settlements, to an email or phone number |
| **Webhooks** with signature verification | Confirming captures and payouts before the ledger counts them |
| **Transaction Search** (Reporting API) | Comparing the PayPal account’s history with the ledger to flag money moved outside CoTreasury |

### Who holds the money

The money sits in one **PayPal business account**, owned by whoever registered it with PayPal. The group does
not jointly own it. In this sandbox build:

- each demo is connected to its own sandbox business account (the Johnsons use the shared one);
- treasuries you create run on a shared sandbox business account. The PayPal email entered during setup is
  recorded but not yet connected. Connecting each group’s own account would use PayPal’s partner onboarding.

CoTreasury only controls the payments it requests. It **cannot stop the account holder** from moving money
directly in PayPal. That’s why it regularly compares the account’s PayPal history with the ledger and shows
anything it didn’t initiate to the whole group.

## The AI Treasurer (tools)

The AI Treasurer is an **impartial assistant, not the authority over the money**. It explains the finances and
helps members prepare contributions and requests. It **cannot approve requests, bypass the group’s rules, or
initiate payments** on its own.

- **Model:** Claude (`claude-opus-5-5`) by Anthropic, via the Anthropic TypeScript SDK with tool use.
- **Tools** (read and draft only):
  - `get_treasury_state`: balances, goals, open requests and rules from the ledger
  - `search_history`: looks up every payment and activity-log event for any day or period, e.g. *“What happened in September?”*
  - `check_affordability`: whether a spend fits the available balance and how many approvals it needs
  - `prepare_contribution`: pre-fills an Add funds payment that the member confirms with PayPal
  - `draft_spending_request`: drafts a payout request that the member reviews and submits
- **Who does what:** a member submits each request. The server recalculates the amount and the required
  approvals from the ledger and the group’s rules, ignoring anything in the AI’s draft. People approve,
  PayPal processes the payment, and the ledger records the verified result.
- Each member’s chat is private and not saved. Limited to 20 questions per hour.

## Activity log: tamper-evident, not tamper-proof

Every action (requests, votes, payments, rule changes, members joining or leaving) is written to an
append-only activity log. Each entry stores a SHA-256 hash of its own content plus the previous entry’s hash.

- **What this gives you:** if a past entry is edited, inserted or deleted, the hashes no longer line up.
  Anyone in the group can press **Check integrity** on the Activity log tab: the server recomputes every hash
  (`verifyChain()` in [`src/lib/audit.ts`](src/lib/audit.ts)) and shows either “All N events are intact” with
  the latest hash, or the first entry where the chain breaks.
- **What it doesn’t:** the log is stored in CoTreasury’s own database, so someone with direct database access
  could rewrite the whole chain consistently and the check would still pass. Publishing the latest hash
  somewhere outside CoTreasury would be needed to catch that.

## AG Grid

The shared ledger is built with **AG Grid** (community): search, money in/out filters, colour-coded amounts
and status pills, a running balance, a pinned totals row, CSV export and a receipt for each row.

---

## Tech stack

Next.js 16 (App Router) · React · TypeScript · Prisma + SQLite · Tailwind CSS · AG Grid · Anthropic SDK ·
PayPal REST APIs · hosted on Railway.

## Run locally

```bash
npm install
npx prisma db push
npm run seed
npm run dev
```

Create `.env.local`:

```
ANTHROPIC_API_KEY=...
PAYPAL_CLIENT_ID=...          # PayPal sandbox app (developer.paypal.com)
PAYPAL_CLIENT_SECRET=...
PAYPAL_WEBHOOK_ID=...
```

Optional: give a demo its own sandbox business account with `PAYPAL_CLIENT_ID_<KEY>`,
`PAYPAL_CLIENT_SECRET_<KEY>` and `PAYPAL_WEBHOOK_ID_<KEY>` (keys: `LISBON`, `MAYA`, `JOHNSONS`).

## License

[MIT](LICENSE)
