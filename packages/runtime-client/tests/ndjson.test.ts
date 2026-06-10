import assert from "node:assert/strict";
import test from "node:test";

import { NdjsonDecoder, RuntimeProtocolError } from "../src/index.js";

test("NDJSON 解码器可处理 Unicode 字节分块与连续消息", () => {
  const decoder = new NdjsonDecoder();
  const bytes = new TextEncoder().encode('{"message":"你好"}\n{"message":"继续"}\r\n');
  const firstNewline = bytes.indexOf(10);
  const first = bytes.slice(0, 15);
  const second = bytes.slice(15, firstNewline);
  const third = bytes.slice(firstNewline);

  assert.deepEqual(decoder.push(first), []);
  assert.deepEqual(decoder.push(second), []);
  assert.deepEqual(decoder.push(third), ['{"message":"你好"}', '{"message":"继续"}']);
});

test("NDJSON 解码器在流结束时返回最后一条无换行消息", () => {
  const decoder = new NdjsonDecoder();
  assert.deepEqual(decoder.push('{"id":1}'), []);
  assert.deepEqual(decoder.finish(), ['{"id":1}']);
});

test("NDJSON 解码器限制未完成行长度", () => {
  const decoder = new NdjsonDecoder(5);
  assert.throws(() => decoder.push("123456"), RuntimeProtocolError);
});
