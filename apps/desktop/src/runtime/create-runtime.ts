import { isTauri } from "@tauri-apps/api/core";

import type { RuntimeClientPort } from "@mimodex/desktop-core";
import { DemoRuntimeClient } from "./demo-runtime.js";
import { createTauriRuntimeClient } from "./tauri-runtime.js";

export function createDesktopRuntimeClient(): RuntimeClientPort {
  return isTauri() ? createTauriRuntimeClient() : new DemoRuntimeClient();
}
