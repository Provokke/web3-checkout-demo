import {
  createPublicClient,
  createWalletClient,
  custom,
  isHex,
  keccak256,
  size,
  toHex,
  type Address,
  type EIP1193Provider,
  type Hex,
} from "viem";
import { checkoutAbi, OrderState } from "./abi.js";

export type PayErrorCode =
  | "BAD_AMOUNT"
  | "NO_ACCOUNT"
  | "ORDER_NOT_PAYABLE"
  | "WRONG_AMOUNT"
  | "TX_REVERTED";

export class PayError extends Error {
  constructor(
    readonly code: PayErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PayError";
  }
}

export interface PayerConfig {
  /** EIP-1193 provider: `window.ethereum` in a browser, or `httpProvider(url)` against a local node. */
  provider: EIP1193Provider;
  contractAddress: Address;
}

/** A 32-byte hex string is used as-is; any other string is keccak256-hashed into an order id. */
export function toOrderId(input: string): Hex {
  if (isHex(input) && size(input) === 32) return input;
  return keccak256(toHex(input));
}

export function createPayer(cfg: PayerConfig) {
  const transport = custom(cfg.provider);
  const publicClient = createPublicClient({ transport });
  const walletClient = createWalletClient({ transport });

  /** Wallet connect: asks the provider for accounts and returns the first. */
  async function connect(): Promise<Address> {
    const [account] = await walletClient.requestAddresses();
    if (!account) throw new PayError("NO_ACCOUNT", "wallet returned no account");
    return account;
  }

  /**
   * Pay an order. Checks the on-chain order first so a wrong amount or an already-paid order
   * fails client-side with a readable error instead of a reverted (gas-burning) transaction.
   */
  async function pay(orderIdInput: string, amountWei: bigint): Promise<{ txHash: string }> {
    if (amountWei <= 0n) throw new PayError("BAD_AMOUNT", "amount must be a positive number of wei");
    const orderId = toOrderId(orderIdInput);
    const [price, , state] = await publicClient.readContract({
      address: cfg.contractAddress,
      abi: checkoutAbi,
      functionName: "orders",
      args: [orderId],
    });
    if (state !== OrderState.Created) {
      throw new PayError("ORDER_NOT_PAYABLE", `order ${orderId} is not open for payment (state ${state})`);
    }
    if (price !== amountWei) {
      throw new PayError("WRONG_AMOUNT", `order price is ${price} wei, tried to pay ${amountWei}`);
    }
    const account = await connect();
    const txHash = await walletClient.writeContract({
      chain: null,
      account,
      address: cfg.contractAddress,
      abi: checkoutAbi,
      functionName: "pay",
      args: [orderId],
      value: amountWei,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") throw new PayError("TX_REVERTED", `transaction ${txHash} reverted`);
    return { txHash };
  }

  return { connect, pay };
}
