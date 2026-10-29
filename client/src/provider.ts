import type { EIP1193Provider } from "viem";

/**
 * Minimal EIP-1193 provider over JSON-RPC HTTP, for a local node whose accounts are unlocked
 * (anvil/hardhat). It stands in for `window.ethereum` so the same pay flow runs unchanged
 * in a browser with a real wallet. `eth_requestAccounts` is mapped to `eth_accounts`.
 */
export function httpProvider(url: string, accountIndex = 0): EIP1193Provider {
  let id = 0;
  const rpc = async (method: string, params: unknown): Promise<unknown> => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params: params ?? [] }),
    });
    const body = (await res.json()) as { result?: unknown; error?: { message: string } };
    if (body.error) throw new Error(body.error.message);
    return body.result;
  };
  return {
    request: async ({ method, params }: { method: string; params?: unknown }) => {
      if (method === "eth_requestAccounts" || method === "eth_accounts") {
        const all = (await rpc("eth_accounts", [])) as string[];
        const pick = all[accountIndex];
        if (!pick) throw new Error(`node has no account at index ${accountIndex}`);
        return [pick];
      }
      return rpc(method, params);
    },
  } as unknown as EIP1193Provider;
}
