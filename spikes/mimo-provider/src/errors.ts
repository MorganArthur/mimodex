import type {
  NormalizedErrorCategory,
  NormalizedProviderError,
} from "./types.js";
import { redact } from "./redact.js";

export class ProviderError extends Error {
  readonly details: NormalizedProviderError;

  constructor(details: NormalizedProviderError) {
    super(details.message);
    this.name = "ProviderError";
    this.details = details;
  }
}

export function normalizeHttpError(
  status: number,
  rawMessage: string,
  requestId: string | undefined,
  secrets: string[],
): NormalizedProviderError {
  const category = categoryForStatus(status, rawMessage);
  return {
    category,
    status,
    ...(requestId ? { requestId } : {}),
    message: redact(truncate(rawMessage || `MiMo API 返回 HTTP ${status}`, 2_000), secrets),
    retryable: status === 408 || status === 409 || status === 429 || status >= 500,
  };
}

export function normalizeThrownError(error: unknown, secrets: string[]): NormalizedProviderError {
  if (error instanceof ProviderError) return error.details;

  if (error instanceof DOMException && error.name === "AbortError") {
    return {
      category: "cancelled",
      message: "MiMo API 请求已取消或超时。",
      retryable: false,
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  return {
    category: "network",
    message: redact(truncate(message, 2_000), secrets),
    retryable: true,
  };
}

function categoryForStatus(status: number, message: string): NormalizedErrorCategory {
  if (status === 401 || status === 403) return "authentication";
  if (status === 429) return "rate_limit";
  if (status === 408 || status === 504) return "timeout";
  if (status >= 500) return "provider_unavailable";
  if (/context|token|length/i.test(message)) return "context_limit";
  if (status >= 400) return "invalid_request";
  return "unknown";
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...[TRUNCATED]`;
}
