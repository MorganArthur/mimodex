import { ChatStreamAccumulator } from "./accumulator.js";
import { normalizeHttpError, normalizeThrownError, ProviderError } from "./errors.js";
import { parseJsonSse } from "./sse.js";
import type { ProbeConfig } from "./config.js";
import type {
  ChatCompletionChunk,
  ChatCompletionRequest,
  CompletedAssistantMessage,
  NormalizedProviderError,
  NormalizedStreamEvent,
} from "./types.js";

export interface StreamOptions {
  signal?: AbortSignal;
  onEvent?: (event: NormalizedStreamEvent) => void;
}

export type FetchImplementation = typeof fetch;

export class MimoClient {
  constructor(
    private readonly config: ProbeConfig,
    private readonly fetchImplementation: FetchImplementation = fetch,
  ) {}

  async streamCompletion(
    request: Omit<ChatCompletionRequest, "stream">,
    options: StreamOptions = {},
  ): Promise<CompletedAssistantMessage> {
    const apiKey = this.config.apiKey;
    if (!apiKey) {
      throw new Error("未配置 MIMO_API_KEY。真实 API 探针无法运行。");
    }

    const timeoutController = new AbortController();
    const timeout = setTimeout(() => timeoutController.abort(), this.config.requestTimeoutMs);
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeoutController.signal])
      : timeoutController.signal;

    try {
      const response = await this.fetchImplementation(`${this.config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "api-key": apiKey,
        },
        body: JSON.stringify({
          ...request,
          stream: true,
        } satisfies ChatCompletionRequest),
        signal,
      });

      const requestId =
        response.headers.get("x-request-id") ??
        response.headers.get("request-id") ??
        undefined;

      if (!response.ok) {
        const message = await response.text();
        throw new ProviderError(normalizeHttpError(response.status, message, requestId, [apiKey]));
      }

      if (!response.body) {
        throw new ProviderError({
          category: "provider_unavailable",
          ...(requestId ? { requestId } : {}),
          message: "MiMo API 响应没有可读取的流。",
          retryable: true,
        });
      }

      const accumulator = new ChatStreamAccumulator();
      for await (const chunk of parseJsonSse<ChatCompletionChunk>(response.body)) {
        for (const event of accumulator.consume(chunk)) {
          options.onEvent?.(event);
        }
      }

      return accumulator.complete();
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if (timeoutController.signal.aborted && !options.signal?.aborted) {
        throw new ProviderError({
          category: "timeout",
          message: `MiMo API 请求超过 ${this.config.requestTimeoutMs}ms。`,
          retryable: true,
        });
      }
      throw new ProviderError(normalizeThrownError(error, [apiKey]));
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function describeProviderError(error: unknown): NormalizedProviderError | undefined {
  return error instanceof ProviderError ? error.details : undefined;
}
