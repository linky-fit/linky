import "@linky-fit/ui/manrope.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./page.css";
import { Root } from "./Root";

const container = document.getElementById("root");
if (!container) throw new Error("Missing root container");
createRoot(container).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
