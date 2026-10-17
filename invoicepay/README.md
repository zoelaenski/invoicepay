# InvoicePay

A [PayBox](https://paybox.sh) marketplace plugin that lets an AI agent **pay a merchant invoice in USDC on Solana** and then **verify on-chain that the payment arrived**.

Built for the MoonPay x PayBox hackathon (Chapter 1), Merchant tools category.

> Prototype. Not security audited. Solana mainnet and standard USDC only.

## Why

Agents can already draft invoices and reconcile payments, but paying one normally means handing an agent a wallet. InvoicePay keeps the user in control: the plugin only *proposes* a transaction. PayBox simulates it, shows the details, and requires the user's approval before anything is signed or sent.

## Tools

### `propose_usdc_payment`

Prepares an **unsigned** Solana USDC transfer for the user to approve in PayBox.

| Input | Description |
|---|---|
| `sender` | Public Solana address of the paying wallet |
| `recipient` | Public Solana address of the merchant |
| `amountUsdc` | Amount as a decimal string, e.g. `"12.50"` (up to 6 decimals, must be > 0) |
| `memo` | Optional invoice reference (max 100 chars), recorded on-chain, e.g. `INV-1042` |

The transaction creates the merchant's USDC token account if it doesn't exist, transfers the exact amount with `transferChecked` (6 decimals), and adds the memo. It has exactly one signer (the sender, who is also the fee payer). Sender and recipient must differ. The plugin never holds keys and never signs.

### `verify_usdc_payment`

Read-only check of whether a transaction paid the merchant at least the invoice amount.

| Input | Description |
|---|---|
| `signature` | Solana transaction signature of the payment |
| `recipient` | Public Solana address of the merchant |
| `minAmountUsdc` | Invoice amount as a decimal string |

It reads the confirmed transaction from Solana RPC and measures the recipient's USDC balance change (post minus pre balance for the USDC mint). Result `status` is one of:

`confirmed_paid`, `confirmed_underpaid`, `not_found`, `failed_on_chain`, `no_usdc_to_recipient`

The response also includes `verified` (boolean), `receivedUsdc`, `expectedUsdc` and `signature`.

## Design notes

- **Stateless.** PayBox runs every plugin call in a fresh sandbox, so there is no invoice database. The invoice reference travels with the payment as a memo, and the blockchain is the source of truth.
- **Exact amounts.** Decimal strings are converted to atomic units without floating point.
- **Bounded network use.** The only network call is one Solana RPC request with a 4-second timeout.

## Use cases

- A freelancer's agent sends an invoice; the client's agent pays and verifies it.
- A business agent pays supplier invoices, with a human approving each one.
- A merchant's agent confirms payment before releasing goods or access.

## Build

Requires Node.js 22+.

```bash
npm ci
npm run typecheck
npm run build      # writes dist/plugin.mjs
```

`dist/plugin.mjs` is the single file uploaded to the PayBox developer portal. The build is reproducible: this source rebuilds to the exact bundle that was submitted (SHA-256 `97ddb36d11846dc7f7c7dfb449b763647814a96b96f2fd2a4fa6df9c9080ebe6`).

`scripts/build.mjs` adds a small `require` shim to the bundle because the Solana libraries call `require()` inside an ES-module build.

## Hosted configuration

In the PayBox developer portal, add the network host `api.mainnet-beta.solana.com` (used by `verify_usdc_payment`). No secrets or variables are needed.

## Known limits

- Verification checks recipient and amount, not that the on-chain memo matches an invoice ID.
- Uses Solana's public RPC, which can be rate limited.
- Solana mainnet and USDC only.

## Possible next steps

Memo matching, other stablecoins and chains, partial and recurring payments.

## Demo

Demo video: https://x.com/zoelaenskai_/status/2111557412964778168
Example payment on Solscan: https://solscan.io/tx/3k38ZfXZn8t3ZrHdpoqzEfkg713yzTSGGiEBbA6WJnNat9NwXNTkvkrh9UL2N2kqUHikfxQ1DCEEkYtQzBS3mB5U
