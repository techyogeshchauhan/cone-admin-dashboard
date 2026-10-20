import { BrandingProvider } from "./Branding";
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./dashboard-theme.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrandingProvider>
      <App />
    </BrandingProvider>
  </React.StrictMode>,
);
