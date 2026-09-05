import Nav from "./components/Nav";
import Hero from "./components/Hero";
import DemoDashboard from "./components/DemoDashboard";
import Overview from "./components/Overview";
import PipelineBreakdown from "./components/PipelineBreakdown";
import ArchitectureInvariants from "./components/ArchitectureInvariants";
import FAQ from "./components/FAQ";
import Ecosystem from "./components/Ecosystem";
import Footer from "./components/Footer";
import { Section } from "./components/primitives";
import { WalletProvider } from "./lib/wallet";
import { ReviewerProvider } from "./lib/reviewerContext";
import { ErrorBoundary } from "./components/ErrorBoundary";

export default function App() {
  return (
    <ErrorBoundary>
    <WalletProvider>
    <ReviewerProvider>
    <div className="min-h-screen">
      <Nav />
      <main>
        <Hero />

        <Section
          id="demo"
          index="§0"
          eyebrow="live demo · interactive"
          title="Run raw data through the pipeline"
          lead="Edit the inputs or pick a preset, then trigger consensus. Watch each agent execute, validators vote, and the final decision resolve — every envelope shown in full."
        >
          <DemoDashboard />
        </Section>

        <Overview />
        <PipelineBreakdown />
        <ArchitectureInvariants />
        <FAQ />
        <Ecosystem />
      </main>
      <Footer />
    </div>
    </ReviewerProvider>
    </WalletProvider>
    </ErrorBoundary>
  );
}
