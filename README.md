# CoTreasury

**A treasury governed by the collective it serves.**

*Shared purpose. Shared treasury. Collective control.*

When people share a purpose, managing the money shouldn't depend on one person. CoTreasury gives groups a
shared financial layer to coordinate contributions, understand their treasury, govern spending, and act
together, with AI as the financial coordinator and people in control.

> AI coordinates. People govern. PayPal moves. The ledger remembers.

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
