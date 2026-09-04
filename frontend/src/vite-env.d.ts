/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GENLAYER_CONTRACT?: string;
  readonly VITE_GENLAYER_NETWORK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Minimal EIP-1193 provider surface (MetaMask, injected wallets, GenLayer provider).
interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  on?(event: string, listener: (...args: any[]) => void): void;
  removeListener?(event: string, listener: (...args: any[]) => void): void;
  isMetaMask?: boolean;
  isPhantom?: boolean;
  providers?: Eip1193Provider[];
  // Some providers self-report an EIP-6963-style info block on the instance.
  info?: { rdns?: string; name?: string };
}

// EIP-6963: an injected provider announced by a wallet extension. Multiple wallets
// (MetaMask, Phantom, …) each announce their own detail so a dapp can pick the
// right one instead of guessing at the single, collision-prone window.ethereum.
interface EIP6963ProviderInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}
interface EIP6963ProviderDetail {
  info: EIP6963ProviderInfo;
  provider: Eip1193Provider;
}
interface EIP6963AnnounceProviderEvent extends CustomEvent {
  type: "eip6963:announceProvider";
  detail: EIP6963ProviderDetail;
}

interface WindowEventMap {
  "eip6963:announceProvider": EIP6963AnnounceProviderEvent;
}

interface Window {
  ethereum?: Eip1193Provider;
  genlayer?: Eip1193Provider;
}
