# Contract risks

`src/Checkout.sol` is **unaudited demo code and has never been deployed to any live chain** (mainnet or testnet). Do not put real funds in it. This file lists what the author knows about; it is not a substitute for an audit.

## What the contract defends against (and the test that shows it)

| Risk | Mitigation | Test |
|---|---|---|
| Reentrancy on refund / withdraw | State is set to `Refunded` (or the pending balance zeroed) before the ETH call, plus a `nonReentrant` lock | `test_ReentrancyOnRefundBlocked`, `testFuzz_ReentrantRefundNeverOverpays` |
| Wrong-amount payment | `pay` requires `msg.value == price` set by the merchant | `testFuzz_WrongAmountPaymentReverts` |
| Double payment | Order must be in `Created` state | `test_RevertWhen_PayTwice` |
| Double release / release after refund | Release requires `Paid` state | `testFuzz_DoubleReleaseCreditsOnce`, `test_RefundOnlyBeforeRelease` |
| Anyone releasing funds | `release` and `createOrder` are merchant-only | `test_RevertWhen_NonMerchantReleases` |
| Merchant proceeds stuck by a reverting receiver | Release only credits a pull-payment balance; the merchant calls `withdraw` | `testFuzz_PayAmountsReleaseExact` |
| Stray ETH | No `receive`/`fallback`: plain transfers revert | `test_RevertWhen_PlainTransfer` |

## Known limitations and open risks

- **Merchant is a single trusted address, immutable.** If the key is lost, funds for orders still in `Paid` state can only be refunded, never released, by someone else (the payer can still refund). If the key is compromised, the attacker can create orders and release paid ones. There is no key rotation, multisig, or timelock.
- **No timeout or dispute flow.** A merchant can leave a paid order unreleased forever; the payer can always refund themselves, and the merchant can also refund. There is no third-party arbiter, so this is not a trust-minimised escrow.
- **Refund is a push payment.** If the payer is a contract that rejects ETH, `refund` reverts with `TransferFailed` and that order stays `Paid` (funds are safe, but cannot be returned to that address).
- **Order ids are public and first-come.** Anyone can pay an open order, and the payer recorded is whoever paid first. Front-running a payer's transaction for the same order id is possible; the front-runner then owns the refund right. Use unguessable ids and treat the merchant's order creation as the authentication step.
- **Order ids and prices are chosen by the merchant off-chain.** The contract does not verify what the order is for, and there is no currency conversion: ETH only, no ERC-20, no price oracle.
- **Gas griefing / DoS:** none known on the paths above (no loops over user data), but not formally analysed.
- **Compiler and EVM:** pinned to solc 0.8.24, `evm_version = paris` (no PUSH0) for wide chain compatibility. Not checked on any L2.
- **Not done:** no formal verification, no Slither/Mythril run, no invariant test suite beyond the fuzz tests, no independent review, no testnet deployment.

## Client risks

- `client/src/pay.ts` checks the order on-chain before sending, but that check is advisory (the contract is the authority). A hostile RPC could lie to the pre-check; the contract still enforces exact amount and state.
- The demo uses anvil's well-known unlocked dev accounts. Never reuse those keys anywhere real.
- Wallet connect is an EIP-1193 `request` interface (`eth_requestAccounts`). It is exercised against a local node through a thin HTTP shim, not against a browser wallet such as MetaMask.
