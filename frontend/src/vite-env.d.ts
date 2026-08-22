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
  providers?: Eip1193Provider[];
}

interface Window {
  ethereum?: Eip1193Provider;
  genlayer?: Eip1193Provider;
}
