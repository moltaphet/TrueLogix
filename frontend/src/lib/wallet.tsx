// Real Web3 wallet connection via EIP-1193 (MetaMask, injected wallets, or a
// GenLayer-injected provider). Exposes a context + useWallet() hook consumed by
// the header button and the demo dashboard. Fully functional detection, connect,
// account display, and live account/chain change handling.

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

export type WalletStatus = "unavailable" | "disconnected" | "connecting" | "connected";

export interface WalletState {
  address: string | null;
  chainId: string | null;
  walletName: string | null;
  status: WalletStatus;
  error: string | null;
  provider: Eip1193Provider | null;
  connect: () => Promise<void>;
  disconnect: () => void;
}

const WalletContext = createContext<WalletState | null>(null);
const PERSIST_KEY = "truelogix.wallet.connected";

// Pick the best injected provider: an explicit GenLayer provider first, then
// MetaMask among multiplexed providers, then any injected wallet.
function detectProvider(): { provider: Eip1193Provider; name: string } | null {
  if (typeof window === "undefined") return null;
  const gl = window.genlayer;
  if (gl && typeof gl.request === "function") return { provider: gl, name: "GenLayer" };

  const eth = window.ethereum;
  if (!eth) return null;
  if (Array.isArray(eth.providers) && eth.providers.length > 0) {
    const mm = eth.providers.find((p) => p.isMetaMask);
    const chosen = mm ?? eth.providers[0];
    return { provider: chosen, name: mm ? "MetaMask" : "Wallet" };
  }
  return { provider: eth, name: eth.isMetaMask ? "MetaMask" : "Wallet" };
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<string | null>(null);
  const [walletName, setWalletName] = useState<string | null>(null);
  const [status, setStatus] = useState<WalletStatus>("disconnected");
  const [error, setError] = useState<string | null>(null);
  const providerRef = useRef<Eip1193Provider | null>(null);

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

  // Detect on mount, restore a prior session silently, and wire live events.
  useEffect(() => {
    const injected = detectProvider();
    if (!injected) {
      setStatus("unavailable");
      return;
    }
    providerRef.current = injected.provider;
    setWalletName(injected.name);

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
    status,
    error,
    provider: providerRef.current,
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
