# TrustPool

**A collectively governed treasury for groups that pool money.**

PayPal already helps groups *collect* money. TrustPool helps them *spend* it together:
an AI Treasurer coordinates, members approve by the group's own rules, PayPal moves the money,
and a shared ledger shows everyone where every dollar went.

> AI proposes. Humans govern. PayPal executes. Webhooks verify. The ledger records.

Built for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/).

## Status

Work in progress. Implemented so far:

- Collectives with members, approvers and configurable approval tiers
- Shared ledger (AG Grid) with running balance and verification source per entry
- Deterministic treasury math (available, committed, awaiting approval)
- Demo mode: switch between members to try the approval flow

Coming next: PayPal sandbox contributions and payouts, webhook verification, the AI Treasurer,
and the unapproved-movement monitor.

## Run locally

```bash
npm install
npx prisma db push
npm run seed
npm run dev
```

## License

MIT
