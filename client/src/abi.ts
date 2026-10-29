import { parseAbi } from "viem";

/** Human-readable ABI for src/Checkout.sol (the pieces the client uses). */
export const checkoutAbi = parseAbi([
  "constructor(address merchant_)",
  "function createOrder(bytes32 orderId, uint256 price)",
  "function pay(bytes32 orderId) payable",
  "function release(bytes32 orderId)",
  "function refund(bytes32 orderId)",
  "function withdraw()",
  "function merchant() view returns (address)",
  "function pending(address) view returns (uint256)",
  "function orders(bytes32) view returns (uint256 price, address payer, uint8 state)",
  "event Paid(bytes32 indexed orderId, address indexed payer, uint256 amount)",
]);

/** Mirrors `enum State` in Checkout.sol. */
export const OrderState = { None: 0, Created: 1, Paid: 2, Released: 3, Refunded: 4 } as const;
