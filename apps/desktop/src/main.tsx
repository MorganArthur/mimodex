import { createRoot } from "react-dom/client";

import { DesktopSessionController } from "@mimodex/desktop-core";
import { createCredentialService } from "./credentials.js";
import { DesktopRoot } from "./DesktopRoot.js";
import { createProjectService } from "./projects.js";
import { createDesktopRuntimeClient } from "./runtime/create-runtime.js";
import { createSettingsService } from "./settings.js";
import { createThreadService } from "./threads.js";
import "./styles.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Missing root element");
}

const credentialService = createCredentialService();
const projectService = createProjectService();
const settingsService = createSettingsService();
const threadService = createThreadService();
const createSession = () => new DesktopSessionController(createDesktopRuntimeClient());
createRoot(root).render(
  <DesktopRoot
    credentialService={credentialService}
    createSession={createSession}
    projectService={projectService}
    settingsService={settingsService}
    threadService={threadService}
  />,
);
