import { invoke, isTauri } from "@tauri-apps/api/core";

import type { ModelId, SandboxMode } from "@mimodex/desktop-core";

export const DEFAULT_API_BASE_URL = "https://api.xiaomimimo.com/v1";

export type AppSettings = {
  apiBaseUrl: string;
  defaultModel: ModelId;
  defaultSandbox: SandboxMode;
};

export type ConnectionDiagnosticCategory =
  | "authentication"
  | "endpoint"
  | "missingCredential"
  | "model"
  | "network"
  | "provider"
  | "rateLimit"
  | "success"
  | "timeout";

export type ConnectionDiagnostic = {
  ok: boolean;
  category: ConnectionDiagnosticCategory;
  message: string;
  detail: string;
  latencyMs: number | null;
  statusCode: number | null;
};

export type ConnectionDiagnosticInput = {
  apiKey?: string;
  settings: AppSettings;
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  apiBaseUrl: DEFAULT_API_BASE_URL,
  defaultModel: "mimo-v2.5",
  defaultSandbox: "workspace-write",
};

export interface SettingsService {
  get(): Promise<AppSettings>;
  save(settings: AppSettings): Promise<AppSettings>;
  diagnose(input: ConnectionDiagnosticInput): Promise<ConnectionDiagnostic>;
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

  diagnose(input: ConnectionDiagnosticInput): Promise<ConnectionDiagnostic> {
    const settings = normalizeSettings(input.settings);
    return invoke("diagnose_mimo_connection", {
      apiKey: input.apiKey?.trim() || null,
      apiBaseUrl: settings.apiBaseUrl,
      model: settings.defaultModel,
    });
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

  async diagnose(input: ConnectionDiagnosticInput): Promise<ConnectionDiagnostic> {
    const settings = normalizeSettings(input.settings);
    await new Promise((resolve) => window.setTimeout(resolve, 180));
    return {
      ok: true,
      category: "success",
      message: "连接成功",
      detail: `${settings.defaultModel} 已通过 ${settings.apiBaseUrl} 响应诊断请求。`,
      latencyMs: 180,
      statusCode: 200,
    };
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
