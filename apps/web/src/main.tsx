import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app.js";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Lore could not find the application root");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);

