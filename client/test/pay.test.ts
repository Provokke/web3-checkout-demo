import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { createPayer, toOrderId, PayError } from "../src/pay.js";
import { httpProvider } from "../src/provider.js";
import { startAnvil, deployCheckout, anvilAvailable, type Anvil } from "../src/anvil.js";

describe("toOrderId", () => {
  it("passes a 32-byte hex id through and hashes anything else", () => {
    const hex = "0x" + "ab".repeat(32);
    expect(toOrderId(hex)).toBe(hex);
    expect(toOrderId("order-1")).toMatch(/^0x[0-9a-f]{64}$/);
    expect(toOrderId("order-1")).toBe(toOrderId("order-1"));
    expect(toOrderId("order-1")).not.toBe(toOrderId("order-2"));
  });
});

describe("pay validation (no node needed)", () => {
  const dead = httpProvider("http://127.0.0.1:1");
  const payer = createPayer({ provider: dead, contractAddress: "0x" + "11".repeat(20) as `0x${string}` });
  it("rejects zero and negative amounts before touching the network", async () => {
    await expect(payer.pay("o", 0n)).rejects.toMatchObject({ code: "BAD_AMOUNT" });
    await expect(payer.pay("o", -5n)).rejects.toBeInstanceOf(PayError);
  });
});

const haveAnvil = anvilAvailable();
describe.skipIf(!haveAnvil)("pay flow against local anvil", () => {
  let anvil: Anvil;
  let contract: `0x${string}`;
  let merchantSend: (fn: string, args: unknown[]) => Promise<void>;

  beforeAll(async () => {
    try {
      execFileSync("forge", ["build"], { cwd: new URL("../..", import.meta.url), stdio: "ignore" });
    } catch {
      /* out/ may already exist */
    }
    anvil = await startAnvil(8599);
    const dep = await deployCheckout(anvil.url);
    contract = dep.address;
    merchantSend = dep.merchantSend;
  }, 60_000);
  afterAll(() => anvil?.stop());

  it("pays the exact price and returns a tx hash", async () => {
    await merchantSend("createOrder", [toOrderId("A-1"), 10n ** 16n]);
    const payer = createPayer({ provider: httpProvider(anvil.url, 1), contractAddress: contract });
    const account = await payer.connect();
    expect(account).toMatch(/^0x[0-9a-fA-F]{40}$/);
    const { txHash } = await payer.pay("A-1", 10n ** 16n);
    expect(txHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("refuses a wrong amount client-side, before spending gas", async () => {
    await merchantSend("createOrder", [toOrderId("A-2"), 5n * 10n ** 15n]);
    const payer = createPayer({ provider: httpProvider(anvil.url, 1), contractAddress: contract });
    await expect(payer.pay("A-2", 1n)).rejects.toMatchObject({ code: "WRONG_AMOUNT" });
  });

  it("refuses an unknown or already-paid order", async () => {
    const payer = createPayer({ provider: httpProvider(anvil.url, 1), contractAddress: contract });
    await expect(payer.pay("nope", 1n)).rejects.toMatchObject({ code: "ORDER_NOT_PAYABLE" });
    await expect(payer.pay("A-1", 10n ** 16n)).rejects.toMatchObject({ code: "ORDER_NOT_PAYABLE" });
  });
});
