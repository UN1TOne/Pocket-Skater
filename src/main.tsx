import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { useGameStore } from "@/store/useGameStore";

// Handy for debugging from the devtools console.
if (import.meta.env.DEV) (window as unknown as { __pocketSkater: unknown }).__pocketSkater = { store: useGameStore };

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
