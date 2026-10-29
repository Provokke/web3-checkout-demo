import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createPublicClient, formatEther, http, parseEther } from "viem";
import { checkoutAbi } from "./abi.js";
import { anvilAvailable, deployCheckout, startAnvil } from "./anvil.js";
import { createPayer, PayError, toOrderId } from "./pay.js";
import { httpProvider } from "./provider.js";

const root = new URL("../../", import.meta.url);

async function main() {
  if (!anvilAvailable()) {
    console.error("anvil not found on PATH. Install Foundry (https://getfoundry.sh) and retry.");
    process.exit(1);
  }
  if (!existsSync(new URL("out/Checkout.sol/Checkout.json", root))) {
    console.log("building contract (forge build)...");
    execFileSync("forge", ["build", "--quiet"], { cwd: root, stdio: "inherit" });
  }

  const anvil = await startAnvil(8546);
  try {
    console.log(`local anvil node at ${anvil.url} (chain 31337, throwaway dev keys, no network)`);
    const { address, merchant, merchantSend } = await deployCheckout(anvil.url);
    console.log(`Checkout deployed at ${address}, merchant ${merchant}`);

    const price = parseEther("0.25");
    await merchantSend("createOrder", [toOrderId("order-1001"), price]);
    console.log(`merchant created order-1001 for ${formatEther(price)} ETH`);

    const payer = createPayer({ provider: httpProvider(anvil.url, 1), contractAddress: address });
    console.log(`buyer connected: ${await payer.connect()}`);

    try {
      await payer.pay("order-1001", price - 1n);
    } catch (e) {
      if (!(e instanceof PayError)) throw e;
      console.log(`wrong amount refused client-side: [${e.code}] ${e.message}`);
    }

    const { txHash } = await payer.pay("order-1001", price);
    console.log(`buyer paid, tx ${txHash}`);

    try {
      await payer.pay("order-1001", price);
    } catch (e) {
      if (!(e instanceof PayError)) throw e;
      console.log(`second payment refused: [${e.code}]`);
    }

    await merchantSend("release", [toOrderId("order-1001")]);
    const pub = createPublicClient({ transport: http(anvil.url) });
    const pending = await pub.readContract({
      address,
      abi: checkoutAbi,
      functionName: "pending",
      args: [merchant],
    });
    console.log(`merchant released order, withdrawable ${formatEther(pending)} ETH`);

    await merchantSend("withdraw", []);
    console.log("merchant withdrew. Done: pay -> release -> withdraw on a local chain.");
  } finally {
    anvil.stop();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
