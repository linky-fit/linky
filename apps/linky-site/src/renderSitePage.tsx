import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { SiteRoot } from "./SiteRoot";

export const renderSitePage = (page: ReactNode) => {
  const container = document.getElementById("root");
  if (!container) throw new Error("Missing root container");
  createRoot(container).render(
    <StrictMode>
      <SiteRoot>{page}</SiteRoot>
    </StrictMode>,
  );
};
