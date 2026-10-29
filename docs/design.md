# Design note

## Goal
Show a payment/escrow contract that an agency client could read in ten minutes, with the failure modes tested (not just the happy path), and a client that proves the flow end to end on a local chain.

## Order lifecycle

```
None --createOrder(merchant)--> Created --pay(exact price)--> Paid --release(merchant)--> Released
                                                                \--refund(payer|merchant)--> Refunded
```

Every transition checks the current state first, so each order can end exactly once: paid once, then released or refunded, never both.

## Decisions

- **Merchant fixes the price per order** (`createOrder`). This is what makes "wrong amount" a contract-level rule instead of a client convention: `pay` reverts unless `msg.value == price`. Over- and under-payment both revert, so no change/dust handling exists.
- **Release is pull-payment.** `release` only moves value from the order to `pending[merchant]`; the merchant calls `withdraw`. A hostile or broken merchant wallet cannot block state changes.
- **Refund is push.** The payer (or the merchant on the payer's behalf) triggers it and the ETH goes to the recorded payer. It follows checks-effects-interactions and also takes a `nonReentrant` lock. The guard is defence in depth: state is already `Refunded` before the call, so a re-entrant call would revert on state anyway. The tests assert the observable result (attacker receives exactly its own payment, other escrow untouched).
- **Custom errors** carry the order id and the actual state so the client can show a readable reason.
- **No upgradeability, no owner functions, no token support.** Less surface, easier to read.

## Client

`createPayer({provider, contractAddress})` takes any EIP-1193 provider. In a browser that is `window.ethereum`; in the demo and tests it is `httpProvider(url)`, a shim over an anvil node with unlocked accounts. `pay(orderId, amountWei)` checks the order on-chain first (state and price), sends the transaction, waits for the receipt and returns `{ txHash }`.

## Toolchain
Foundry (`forge`, `anvil`) with forge-std as a pinned git submodule. The client uses viem and vitest. The client tests and demo start their own anvil process on a local port.
