import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

export interface ReviewerContextValue {
  reviewer: boolean;
  enableReviewer: () => void;
  disableReviewer: () => void;
}

const ReviewerContext = createContext<ReviewerContextValue | null>(null);

export function ReviewerProvider({ children }: { children: ReactNode }) {
  const [reviewer, setReviewer] = useState(false);
  const enableReviewer = useCallback(() => {
    setReviewer(true);
    // Scroll the steward to the demo section so they see the mode activate.
    const el = document.getElementById("demo");
    if (el) el.scrollIntoView({ behavior: "smooth" });
  }, []);
  const disableReviewer = useCallback(() => setReviewer(false), []);

  return (
    <ReviewerContext.Provider value={{ reviewer, enableReviewer, disableReviewer }}>
      {children}
    </ReviewerContext.Provider>
  );
}

export function useReviewer(): ReviewerContextValue {
  const ctx = useContext(ReviewerContext);
  if (!ctx) throw new Error("useReviewer must be used within <ReviewerProvider>");
  return ctx;
}
