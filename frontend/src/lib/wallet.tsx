// Real Web3 wallet connection via EIP-1193 (MetaMask, injected wallets, or a
// GenLayer-injected provider). Exposes a context + useWallet() hook consumed by
// the header button and the demo dashboard. Fully functional detection, connect,
// account display, and live account/chain change handling.

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

// ---------------------------------------------------------------------------
// StudioNet chain parameters (Chain ID 61999 / 0xF22F)
// ---------------------------------------------------------------------------
const STUDIONET_CHAIN_ID = 61999;
export const STUDIONET_CHAIN_ID_HEX = "0xF22F";

const STUDIONET_PARAMS = {
  chainId: STUDIONET_CHAIN_ID_HEX,
  chainName: "GenLayer StudioNet",
  nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 },
  rpcUrls: ["https://studio.genlayer.com/api"],
  blockExplorerUrls: ["https://explorer-studio.genlayer.com"],
} as const;

/**
 * Attempt to switch the wallet to StudioNet.
 *   - Tries wallet_switchEthereumChain first.
 *   - On 4902 (chain not added) → calls wallet_addEthereumChain.
 *   - On 4001 (user rejected) or any other error → re-throws so the caller
 *     can surface the manual-switch banner instead of crashing.
 */
async function switchToStudioNet(provider: Eip1193Provider): Promise<void> {
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: STUDIONET_CHAIN_ID_HEX }],
    });
  } catch (switchErr: unknown) {
    const code = (switchErr as { code?: number })?.code;
    if (code === 4902) {
      // Chain is not in the wallet's list — add it (this also switches to it).
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [STUDIONET_PARAMS],
      });
    } else {
      // 4001 = user rejected, or unrecognised error.
      // Re-throw so the caller shows the manual banner instead of silently failing.
      throw switchErr;
    }
  }
}

export type WalletStatus = "unavailable" | "disconnected" | "connecting" | "connected";

export interface WalletState {
  address: string | null;
  chainId: string | null;
  walletName: string | null;
  // EIP-6963 rdns of the connected provider ("io.metamask", …), when known.
  rdns: string | null;
  status: WalletStatus;
  error: string | null;
  provider: Eip1193Provider | null;
  // true when the wallet is connected but NOT on StudioNet (chain 61999).
  wrongNetwork: boolean;
  // Trigger a switch to StudioNet — used by the manual banner button.
  switchNetwork: () => Promise<void>;
  connect: () => Promise<void>;
  disconnect: () => void;
}

const WalletContext = createContext<WalletState | null>(null);
const PERSIST_KEY = "truelogix.wallet.connected";

const METAMASK_RDNS = "io.metamask";
const PHANTOM_RDNS = "app.phantom";

// EIP-6963 provider store. Multiple wallets (MetaMask, Phantom, …) each announce
// their own provider via `eip6963:announceProvider`, so we can select the RIGHT
// one by rdns instead of gambling on the single, collision-prone window.ethereum.
// This is what keeps a Phantom sitting on window.ethereum from hijacking flows
// that must run against MetaMask (e.g. the GenLayer Snap).
const announcedProviders: EIP6963ProviderDetail[] = [];

if (typeof window !== "undefined") {
  window.addEventListener("eip6963:announceProvider", (event) => {
    const detail = (event as EIP6963AnnounceProviderEvent).detail;
    if (!detail?.info?.uuid || !detail.provider) return;
    if (!announcedProviders.some((d) => d.info.uuid === detail.info.uuid)) {
      announcedProviders.push(detail);
    }
  });
  // Ask any already-loaded wallets to (re)announce themselves.
  window.dispatchEvent(new Event("eip6963:requestProvider"));
}

// Is this a genuine MetaMask (and NOT Phantom impersonating isMetaMask)?
function providerIsMetaMask(provider: Eip1193Provider | undefined, rdns?: string): boolean {
  if (!provider) return false;
  if (rdns) return rdns === METAMASK_RDNS;
  if (provider.info?.rdns) return provider.info.rdns === METAMASK_RDNS;
  return provider.isMetaMask === true && provider.isPhantom !== true;
}

export interface ResolvedProvider {
  provider: Eip1193Provider;
  name: string;
  rdns?: string;
}

// Pick the best injected provider, preferring an explicit GenLayer provider,
// then a genuine MetaMask discovered via EIP-6963, then any non-Phantom
// announced wallet, then legacy window.ethereum detection. Phantom is never
// selected as "MetaMask" so Snap-based operations can't be routed to it.
function detectProvider(): ResolvedProvider | null {
  if (typeof window === "undefined") return null;

  const gl = window.genlayer;
  if (gl && typeof gl.request === "function") return { provider: gl, name: "GenLayer" };

  // 1. EIP-6963: prefer a genuine MetaMask by rdns.
  const mm6963 = announcedProviders.find((d) => d.info.rdns === METAMASK_RDNS);
  if (mm6963) return { provider: mm6963.provider, name: "MetaMask", rdns: mm6963.info.rdns };

  // 2. EIP-6963: any announced wallet that isn't Phantom.
  const other6963 = announcedProviders.find((d) => d.info.rdns !== PHANTOM_RDNS);
  if (other6963)
    return { provider: other6963.provider, name: other6963.info.name || "Wallet", rdns: other6963.info.rdns };

  // 3. Legacy multiplexed window.ethereum.providers array.
  const eth = window.ethereum;
  if (!eth) {
    // Only Phantom announced (no genlayer / non-Phantom / legacy)? Still surface
    // it so the user isn't stuck — just not tagged as MetaMask.
    const phantom = announcedProviders.find((d) => d.info.rdns === PHANTOM_RDNS);
    if (phantom) return { provider: phantom.provider, name: phantom.info.name || "Phantom", rdns: phantom.info.rdns };
    return null;
  }
  if (Array.isArray(eth.providers) && eth.providers.length > 0) {
    const mm = eth.providers.find((p) => providerIsMetaMask(p));
    const chosen = mm ?? eth.providers.find((p) => p.isPhantom !== true) ?? eth.providers[0];
    return { provider: chosen, name: providerIsMetaMask(chosen) ? "MetaMask" : "Wallet" };
  }

  // 4. Single legacy provider.
  return { provider: eth, name: providerIsMetaMask(eth) ? "MetaMask" : "Wallet" };
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<string | null>(null);
  const [walletName, setWalletName] = useState<string | null>(null);
  const [rdns, setRdns] = useState<string | null>(null);
  const [status, setStatus] = useState<WalletStatus>("disconnected");
  const [error, setError] = useState<string | null>(null);
  const providerRef = useRef<Eip1193Provider | null>(null);

  // Derived: connected on a chain other than StudioNet.
  const wrongNetwork =
    status === "connected" &&
    chainId !== null &&
    parseInt(chainId, 16) !== STUDIONET_CHAIN_ID;

  // Exposed switch function — called by the manual banner button.
  const switchNetwork = useCallback(async () => {
    const p = providerRef.current;
    if (!p) return;
    // The native GenLayer provider already targets StudioNet — no RPC switch needed.
    if (walletName === "GenLayer") return;
    try {
      await switchToStudioNet(p);
      // chainChanged event will fire and update chainId automatically.
    } catch {
      // User rejected again — banner stays visible; nothing else to do.
    }
  }, [walletName]);

  const disconnect = useCallback(() => {
    setAddress(null);
    setChainId(null);
    setStatus(detectProvider() ? "disconnected" : "unavailable");
    setError(null);
    try {
      localStorage.removeItem(PERSIST_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const connect = useCallback(async () => {
    const injected = detectProvider();
    if (!injected) {
      setStatus("unavailable");
      setError("No wallet detected. Install MetaMask or a GenLayer-compatible wallet.");
      return;
    }
    providerRef.current = injected.provider;
    setWalletName(injected.name);
    setRdns(injected.rdns ?? null);
    setStatus("connecting");
    setError(null);
    try {
      const accounts = (await injected.provider.request({ method: "eth_requestAccounts" })) as string[];
      if (!accounts || accounts.length === 0) {
        setStatus("disconnected");
        return;
      }
      const chain = (await injected.provider.request({ method: "eth_chainId" }).catch(() => null)) as string | null;
      setAddress(accounts[0]);
      setChainId(chain);
      setStatus("connected");
      try {
        localStorage.setItem(PERSIST_KEY, "1");
      } catch {
        /* ignore */
      }
    } catch (e: unknown) {
      const err = e as { code?: number; message?: string };
      setError(err?.code === 4001 ? "Connection request rejected." : err?.message ?? "Failed to connect wallet.");
      setStatus("disconnected");
    }
  }, []);

  // Auto-switch to StudioNet whenever the connected wallet drifts to another chain.
  // Fires on first connect and on every subsequent chainChanged event. Errors are
  // swallowed — if the user rejects, wrongNetwork stays true and the banner appears.
  useEffect(() => {
    if (!wrongNetwork) return;
    const p = providerRef.current;
    if (!p || walletName === "GenLayer") return;
    switchToStudioNet(p).catch(() => {
      // User rejected or unrecoverable — banner stays, no crash.
    });
  }, [wrongNetwork, walletName]);

  // Detect on mount, restore a prior session silently, and wire live events.
  useEffect(() => {
    const injected = detectProvider();
    if (!injected) {
      setStatus("unavailable");
      return;
    }
    providerRef.current = injected.provider;
    setWalletName(injected.name);
    setRdns(injected.rdns ?? null);

    const onAccounts = (accounts: string[]) => {
      if (!accounts || accounts.length === 0) disconnect();
      else {
        setAddress(accounts[0]);
        setStatus("connected");
      }
    };
    const onChain = (id: string) => setChainId(id);

    injected.provider.on?.("accountsChanged", onAccounts);
    injected.provider.on?.("chainChanged", onChain);

    // Silent restore only if the user connected before (no popup).
    let restore = false;
    try {
      restore = localStorage.getItem(PERSIST_KEY) === "1";
    } catch {
      /* ignore */
    }
    if (restore) {
      injected.provider
        .request({ method: "eth_accounts" })
        .then((accs) => {
          const accounts = accs as string[];
          if (accounts && accounts.length > 0) {
            setAddress(accounts[0]);
            setStatus("connected");
            injected.provider.request({ method: "eth_chainId" }).then((c) => setChainId(c as string)).catch(() => {});
          }
        })
        .catch(() => {});
    }

    return () => {
      injected.provider.removeListener?.("accountsChanged", onAccounts);
      injected.provider.removeListener?.("chainChanged", onChain);
    };
  }, [disconnect]);

  const value: WalletState = {
    address,
    chainId,
    walletName,
    rdns,
    status,
    error,
    provider: providerRef.current,
    wrongNetwork,
    switchNetwork,
    connect,
    disconnect,
  };

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within <WalletProvider>");
  return ctx;
}

export function shortAddress(addr: string | null): string {
  if (!addr) return "";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
