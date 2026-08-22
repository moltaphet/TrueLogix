import { useEffect, useRef, useState } from "react";
import { useWallet, shortAddress } from "../lib/wallet";

export default function WalletButton() {
  const { status, address, chainId, walletName, error, connect, disconnect } = useWallet();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  if (status === "unavailable") {
    return (
      <a
        href="https://metamask.io/download/"
        target="_blank"
        rel="noreferrer"
        className="btn btn-ghost px-3.5 py-2 text-sm"
        title="No wallet detected — install one to connect"
      >
        Get a wallet
      </a>
    );
  }

  if (status !== "connected") {
    return (
      <button
        onClick={connect}
        disabled={status === "connecting"}
        className="btn btn-ghost px-3.5 py-2 text-sm disabled:opacity-60"
        title={error ?? "Connect a Web3 wallet"}
      >
        {status === "connecting" ? "Connecting…" : "Connect Wallet"}
      </button>
    );
  }

  const copy = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 rounded-xl border border-line-bright bg-ink-800/70 px-3 py-2 text-sm transition-colors hover:border-fog"
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-pulseRing rounded-full bg-verify opacity-70" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-verify" />
        </span>
        <span className="font-mono text-[13px] text-chalk">{shortAddress(address)}</span>
        <span className="font-mono text-[10px] text-fog" aria-hidden>
          ▾
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="panel absolute right-0 z-50 mt-2 w-64 p-3"
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="kicker">{walletName ?? "wallet"}</span>
            {chainId && <span className="chip">chain {parseInt(chainId, 16) || chainId}</span>}
          </div>
          <button
            onClick={copy}
            className="group flex w-full items-center justify-between gap-2 rounded-lg border border-line bg-ink-950/70 px-3 py-2 text-left"
            title="Copy full address"
          >
            <span className="truncate font-mono text-[12px] text-fog-bright">{address}</span>
            <span className="shrink-0 font-mono text-[10px] text-fog group-hover:text-chalk">
              {copied ? "copied" : "copy"}
            </span>
          </button>
          <button
            onClick={() => {
              disconnect();
              setOpen(false);
            }}
            className="mt-2 w-full rounded-lg border border-line px-3 py-2 text-sm text-fog-bright transition-colors hover:border-alarm/50 hover:text-alarm"
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
