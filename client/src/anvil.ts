import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, type Address, type Hex } from "viem";
import { checkoutAbi } from "./abi.js";

export interface Anvil {
  url: string;
  stop(): void;
}

export function anvilAvailable(): boolean {
  return spawnSync("anvil", ["--version"], { stdio: "ignore" }).status === 0;
}

/** Start a local anvil node on `port` (chain id 31337, unlocked dev accounts) and wait until it listens. */
export function startAnvil(port: number): Promise<Anvil> {
  return new Promise((resolve, reject) => {
    const child: ChildProcess = spawn("anvil", ["--port", String(port), "--silent"], { stdio: "ignore" });
    child.once("error", reject);
    const url = `http://127.0.0.1:${port}`;
    const started = Date.now();
    const poll = async () => {
      try {
        const r = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
        });
        if (r.ok) return resolve({ url, stop: () => void child.kill() });
      } catch {
        /* not up yet */
      }
      if (Date.now() - started > 15_000) {
        child.kill();
        return reject(new Error("anvil did not start within 15s"));
      }
      setTimeout(poll, 150);
    };
    poll();
  });
}

/** Deploy Checkout from forge's build output (`forge build` first). Merchant = anvil account 0. */
export async function deployCheckout(rpcUrl: string) {
  const artifact = JSON.parse(
    readFileSync(new URL("../../out/Checkout.sol/Checkout.json", import.meta.url), "utf8"),
  ) as { bytecode: { object: Hex } };
  const transport = http(rpcUrl);
  const pub = createPublicClient({ transport });
  const wallet = createWalletClient({ transport });
  const [merchant] = await wallet.getAddresses();
  if (!merchant) throw new Error("node has no accounts");

  const deployHash = await wallet.deployContract({
    chain: null,
    account: merchant,
    abi: checkoutAbi,
    bytecode: artifact.bytecode.object,
    args: [merchant],
  });
  const receipt = await pub.waitForTransactionReceipt({ hash: deployHash });
  const address = receipt.contractAddress as Address;

  const merchantSend = async (fn: string, args: unknown[]): Promise<void> => {
    const hash = await wallet.writeContract({
      chain: null,
      account: merchant,
      address,
      abi: checkoutAbi,
      functionName: fn as "createOrder",
      args: args as [Hex, bigint],
    });
    await pub.waitForTransactionReceipt({ hash });
  };
  return { address, merchant, merchantSend };
}
