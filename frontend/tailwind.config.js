/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Obsidian base — cool blue-slate undertone, not flat black.
        ink: {
          950: "#080A0F",
          900: "#0B0E14",
          850: "#0E121B",
          800: "#111624",
          700: "#141A2B",
        },
        line: {
          DEFAULT: "#1E2436",
          bright: "#2A3348",
        },
        fog: {
          DEFAULT: "#8A93A6", // muted text
          bright: "#B4BCCD",
        },
        chalk: "#E6EAF2", // primary text
        // Tri-agent chromatic system + consensus resolution.
        agentA: "#38BDF8", // Extractor — sky
        agentB: "#F59E0B", // Auditor — amber
        agentC: "#A78BFA", // Synthesizer — violet
        verify: "#34D399", // Consensus — emerald
        alarm: "#FB7185", // reject/disagree — rose
      },
      fontFamily: {
        display: ['"Space Grotesk"', "system-ui", "sans-serif"],
        sans: ['"Inter"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
      },
      letterSpacing: {
        kicker: "0.28em",
      },
      boxShadow: {
        panel: "0 1px 0 0 rgba(255,255,255,0.03) inset, 0 24px 60px -30px rgba(0,0,0,0.9)",
        glowA: "0 0 0 1px rgba(56,189,248,0.35), 0 0 40px -8px rgba(56,189,248,0.45)",
        glowB: "0 0 0 1px rgba(245,158,11,0.35), 0 0 40px -8px rgba(245,158,11,0.45)",
        glowC: "0 0 0 1px rgba(167,139,250,0.35), 0 0 40px -8px rgba(167,139,250,0.45)",
        glowV: "0 0 0 1px rgba(52,211,153,0.4), 0 0 44px -8px rgba(52,211,153,0.5)",
      },
      backgroundImage: {
        grid:
          "linear-gradient(to right, rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.035) 1px, transparent 1px)",
        "radial-fade":
          "radial-gradient(120% 120% at 50% 0%, rgba(56,189,248,0.10), rgba(167,139,250,0.06) 40%, transparent 70%)",
      },
      keyframes: {
        flow: {
          "0%": { strokeDashoffset: "0" },
          "100%": { strokeDashoffset: "-28" },
        },
        rise: {
          "0%": { opacity: "0", transform: "translateY(14px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        pulseRing: {
          "0%,100%": { opacity: "0.55" },
          "50%": { opacity: "1" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        blip: {
          "0%": { transform: "scale(0.6)", opacity: "0" },
          "40%": { transform: "scale(1)", opacity: "1" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
      },
      animation: {
        flow: "flow 1.1s linear infinite",
        rise: "rise 0.6s cubic-bezier(0.22,1,0.36,1) both",
        pulseRing: "pulseRing 2.4s ease-in-out infinite",
        shimmer: "shimmer 1.6s linear infinite",
        blip: "blip 0.4s ease-out both",
      },
    },
  },
  plugins: [],
};
