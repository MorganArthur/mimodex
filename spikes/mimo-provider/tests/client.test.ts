import assert from "node:assert/strict";
import test from "node:test";
import { MimoClient } from "../src/client.js";
import type { ProbeConfig } from "../src/config.js";

const config: ProbeConfig = {
  apiKey: "sk-test-secret",
  baseUrl: "https://example.invalid/v1",
  model: "mimo-v2.5",
  proModel: "mimo-v2.5-pro",
  maxCompletionTokens: 2048,
  requestTimeoutMs: 5_000,
};

test("发送 api-key、流式请求并归一化响应", async () => {
  let capturedHeaders: Headers | undefined;
  let capturedBody: unknown;
  const mockFetch: typeof fetch = async (_input, init) => {
    capturedHeaders = new Headers(init?.headers);
    capturedBody = JSON.parse(String(init?.body));
    return new Response(
      stream([
        'data: {"id":"r1","choices":[{"index":0,"delta":{"reasoning_content":"想"},"finish_reason":null}]}\n\n',
        'data: {"choices":[{"index":0,"delta":{"content":"完成"},"finish_reason":"stop"}],"usage":{"total_tokens":3}}\n\n',
        "data: [DONE]\n\n",
      ]),
      { status: 200, headers: { "content-type": "text/event-stream" } },
    );
  };

  const client = new MimoClient(config, mockFetch);
  const result = await client.streamCompletion({
    model: config.model,
    messages: [{ role: "user", content: "测试" }],
  });

  assert.equal(capturedHeaders?.get("api-key"), "sk-test-secret");
  assert.equal((capturedBody as { stream: boolean }).stream, true);
  assert.deepEqual(result.message, {
    role: "assistant",
    content: "完成",
    reasoning_content: "想",
  });
});

test("HTTP 错误会归一化并脱敏", async () => {
  const mockFetch: typeof fetch = async () =>
    new Response('credential sk-test-secret invalid', {
      status: 401,
      headers: { "x-request-id": "request-1" },
    });
  const client = new MimoClient(config, mockFetch);

  await assert.rejects(
    client.streamCompletion({
      model: config.model,
      messages: [{ role: "user", content: "测试" }],
    }),
    (error: unknown) => {
      const details = (error as { details?: { category?: string; message?: string } }).details;
      assert.equal(details?.category, "authentication");
      assert.doesNotMatch(details?.message ?? "", /sk-test-secret/);
      return true;
    },
  );
});

test("区分 Provider 请求超时与用户取消", async () => {
  const timeoutConfig = { ...config, requestTimeoutMs: 10 };
  const mockFetch: typeof fetch = async (_input, init) =>
    await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });
  const client = new MimoClient(timeoutConfig, mockFetch);

  await assert.rejects(
    client.streamCompletion({
      model: config.model,
      messages: [{ role: "user", content: "测试" }],
    }),
    (error: unknown) => {
      const details = (error as { details?: { category?: string; retryable?: boolean } }).details;
      assert.equal(details?.category, "timeout");
      assert.equal(details?.retryable, true);
      return true;
    },
  );
});

function stream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}
