import { useWallet } from "../lib/wallet";

export default function WrongNetworkBanner() {
  const { wrongNetwork, switchNetwork } = useWallet();
  if (!wrongNetwork) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="fixed inset-x-0 top-0 z-[9999] flex items-center justify-between gap-4 border-b-2 border-yellow-400 bg-black px-5 py-3 font-mono"
    >
      <span className="text-sm font-bold tracking-widest text-yellow-400 uppercase">
        [ WRONG NETWORK: PLEASE SWITCH TO GENLAYER STUDIONET ]
      </span>
      <button
        onClick={switchNetwork}
        className="shrink-0 border border-yellow-400 px-3 py-1 text-xs font-bold tracking-wider text-yellow-400 transition-colors hover:bg-yellow-400 hover:text-black"
      >
        Switch Network
      </button>
    </div>
  );
}
