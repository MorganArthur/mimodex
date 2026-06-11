import { createRoot } from "react-dom/client";

import { DesktopSessionController } from "@mimodex/desktop-core";
import { App } from "./App.js";
import { createDesktopRuntimeClient } from "./runtime/create-runtime.js";
import "./styles.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Missing root element");
}

const session = new DesktopSessionController(createDesktopRuntimeClient());
createRoot(root).render(<App session={session} />);
