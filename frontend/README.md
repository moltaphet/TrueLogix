# TrueLogix — Frontend

Interactive dashboard + educational showcase for **TrueLogix**, a 3-agent
multi-agent consensus engine on GenLayer.

- **Live demo** — feed raw data through the Extractor → Auditor → Synthesizer
  pipeline, watch validators vote, and inspect every JSON envelope.
- **Educational sections** — how GenLayer consensus works, per-agent breakdowns,
  the calldata / JSON / equivalence invariants, and an FAQ.

## Stack

Vite + React + TypeScript + Tailwind CSS. Dark-mode, responsive, reduced-motion
aware.

## Develop

```bash
cd frontend
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production build to dist/
npm run preview  # serve the production build
```

## Wallet & contract wiring

By default the dashboard runs a **client-side simulation** that mirrors the
contract's exact weighting and decision logic — no wallet or gas required.

**Connect Wallet** in the header uses EIP-1193 (`src/lib/wallet.tsx`): it detects
MetaMask, any injected wallet, or a GenLayer-injected provider, connects via
`eth_requestAccounts`, shows the active account, and tracks account/chain changes
live. No wallet installed → the button offers to get one.

The pipeline runs **on-chain** only when both are true: a wallet is connected
**and** a deployed contract address is set. Then `Run consensus` signs the
`evaluate()` transaction with the connected account.

To enable the deployed path, copy `.env.example` to `.env`, set the address +
network, and install the SDK:

```bash
cp .env.example .env      # set VITE_GENLAYER_CONTRACT + VITE_GENLAYER_NETWORK
npm install genlayer-js
```

The runner (`src/lib/consensus.ts`) tries the on-chain path first via
`src/lib/genlayer.ts` (passing the connected wallet) and falls back to the
simulator on any error, so the same UI works in both modes. Envelope shapes track
`../contracts/true_logix_consensus.py` and `../agents/*.md` (numbers are decimal
strings — GenVM calldata has no float type).

## Structure

```
src/
  lib/
    simulator.ts   # deterministic A→B→C pipeline (mirrors the contract)
    genlayer.ts    # real contract wiring via genlayer-js (env-gated)
    consensus.ts   # unified streaming runner (on-chain → simulator fallback)
    sampleData.ts  # demo presets
  components/       # Hero, DemoDashboard, ConduitDiagram, educational sections
```
