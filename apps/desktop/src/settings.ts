import { invoke, isTauri } from "@tauri-apps/api/core";

import type { ModelId, SandboxMode } from "@mimodex/desktop-core";

export const DEFAULT_API_BASE_URL = "https://api.xiaomimimo.com/v1";

export type AppSettings = {
  apiBaseUrl: string;
  defaultModel: ModelId;
  defaultSandbox: SandboxMode;
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  apiBaseUrl: DEFAULT_API_BASE_URL,
  defaultModel: "mimo-v2.5",
  defaultSandbox: "workspace-write",
};

export interface SettingsService {
  get(): Promise<AppSettings>;
  save(settings: AppSettings): Promise<AppSettings>;
}

export function createSettingsService(): SettingsService {
  return isTauri() ? new TauriSettingsService() : new DemoSettingsService();
}

class TauriSettingsService implements SettingsService {
  get(): Promise<AppSettings> {
    return invoke("get_app_settings");
  }

  save(settings: AppSettings): Promise<AppSettings> {
    return invoke("save_app_settings", { settings: normalizeSettings(settings) });
  }
}

class DemoSettingsService implements SettingsService {
  #settings = DEFAULT_APP_SETTINGS;

  async get(): Promise<AppSettings> {
    return this.#settings;
  }

  async save(settings: AppSettings): Promise<AppSettings> {
    this.#settings = normalizeSettings(settings);
    return this.#settings;
  }
}

export function normalizeSettings(settings: AppSettings): AppSettings {
  const apiBaseUrl = normalizeApiBaseUrl(settings.apiBaseUrl);
  return {
    apiBaseUrl,
    defaultModel: settings.defaultModel === "mimo-v2.5-pro" ? "mimo-v2.5-pro" : "mimo-v2.5",
    defaultSandbox:
      settings.defaultSandbox === "read-only" || settings.defaultSandbox === "danger-full-access"
        ? settings.defaultSandbox
        : "workspace-write",
  };
}

function normalizeApiBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("API Base URL 格式无效。");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("API Base URL 必须使用 HTTP 或 HTTPS。");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("API Base URL 不能包含凭据、查询参数或片段。");
  }
  return trimmed;
}
