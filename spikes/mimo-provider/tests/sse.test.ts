import assert from "node:assert/strict";
import test from "node:test";
import { parseJsonSse, parseSseData } from "../src/sse.js";

test("parseSseData 能处理任意分块和 DONE", async () => {
  const stream = streamFromChunks([
    "data: {\"a\":",
    "1}\r\n\r\ndata: {\"b\":2}\n",
    "\ndata: [DONE]\n\n",
  ]);

  const values: string[] = [];
  for await (const value of parseSseData(stream)) values.push(value);

  assert.deepEqual(values, ['{"a":1}', '{"b":2}', "[DONE]"]);
});

test("parseJsonSse 忽略 DONE 并解析 JSON", async () => {
  const stream = streamFromChunks(['data: {"value":1}\n\ndata: [DONE]\n\n']);
  const values: Array<{ value: number }> = [];
  for await (const value of parseJsonSse<{ value: number }>(stream)) values.push(value);
  assert.deepEqual(values, [{ value: 1 }]);
});

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}
