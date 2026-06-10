import { createRoot } from "react-dom/client";

import { DesktopSessionController } from "@mimodex/desktop-core";
import { App } from "./App.js";
import { DemoRuntimeClient } from "./runtime/demo-runtime.js";
import "./styles.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Missing root element");
}

const session = new DesktopSessionController(new DemoRuntimeClient());
createRoot(root).render(<App session={session} />);
