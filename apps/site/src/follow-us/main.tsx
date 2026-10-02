import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import FollowUsPage from "./FollowUsPage";

const container = document.getElementById("root");

if (!container) {
  throw new Error("Missing root container");
}

createRoot(container).render(
  <StrictMode>
    <FollowUsPage />
  </StrictMode>,
);
