export interface ProbeConfig {
  apiKey?: string;
  baseUrl: string;
  model: string;
  proModel: string;
  maxCompletionTokens: number;
  requestTimeoutMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ProbeConfig {
  const apiKey = env.MIMO_API_KEY?.trim();

  return {
    ...(apiKey ? { apiKey } : {}),
    baseUrl: normalizeBaseUrl(env.MIMO_BASE_URL ?? "https://api.xiaomimimo.com/v1"),
    model: env.MIMO_MODEL?.trim() || "mimo-v2.5",
    proModel: env.MIMO_PRO_MODEL?.trim() || "mimo-v2.5-pro",
    maxCompletionTokens: parsePositiveInt(env.MIMO_MAX_COMPLETION_TOKENS, 2048),
    requestTimeoutMs: parsePositiveInt(env.MIMO_REQUEST_TIMEOUT_MS, 120_000),
  };
}

export function requireApiKey(config: ProbeConfig): string {
  if (!config.apiKey) {
    throw new Error("未配置 MIMO_API_KEY。真实 API 探针无法运行。");
  }

  return config.apiKey;
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
