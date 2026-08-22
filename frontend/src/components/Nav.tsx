import { useEffect, useState } from "react";
import WalletButton from "./WalletButton";

const LINKS = [
  { href: "#demo", label: "Live demo" },
  { href: "#overview", label: "How it works" },
  { href: "#pipeline", label: "Agents" },
  { href: "#architecture", label: "Architecture" },
  { href: "#faq", label: "FAQ" },
];

export const GITHUB_URL = "https://github.com/moltaphet/TrueLogix";

export default function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-colors duration-300 ${
        scrolled ? "border-b border-line bg-ink-900/85 backdrop-blur-md" : "border-b border-transparent"
      }`}
    >
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5">
        <a href="#top" className="group flex items-center gap-2.5" aria-label="TrueLogix home">
          <LogoMark />
          <span className="font-display text-[17px] font-semibold tracking-tight text-chalk">
            True<span className="text-verify">Logix</span>
          </span>
        </a>

        <div className="hidden items-center gap-7 md:flex">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className="text-sm text-fog transition-colors hover:text-chalk">
              {l.label}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="hidden text-sm text-fog transition-colors hover:text-chalk lg:inline">
            GitHub ↗
          </a>
          <WalletButton />
          <button
            className="btn btn-ghost px-3 py-2 md:hidden"
            aria-expanded={open}
            aria-label="Toggle menu"
            onClick={() => setOpen((v) => !v)}
          >
            <span className="font-mono text-xs">{open ? "close" : "menu"}</span>
          </button>
        </div>
      </nav>

      {open && (
        <div className="border-t border-line bg-ink-900/95 px-5 py-3 md:hidden">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className="block py-2 text-sm text-fog-bright hover:text-chalk"
            >
              {l.label}
            </a>
          ))}
        </div>
      )}
    </header>
  );
}

function LogoMark() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden className="shrink-0">
      <circle cx="7" cy="7" r="3" fill="#38BDF8" />
      <circle cx="19" cy="7" r="3" fill="#F59E0B" />
      <circle cx="7" cy="19" r="3" fill="#A78BFA" />
      <circle cx="19" cy="19" r="3.4" fill="#34D399" />
      <path d="M7 7 L19 19 M19 7 L7 19" stroke="#2A3348" strokeWidth="1.2" />
    </svg>
  );
}
