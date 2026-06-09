import assert from "node:assert/strict";
import test from "node:test";
import { ChatStreamAccumulator } from "../src/accumulator.js";

test("组装推理、文本和碎片化工具参数", () => {
  const accumulator = new ChatStreamAccumulator();

  accumulator.consume({
    id: "response-1",
    choices: [
      {
        index: 0,
        delta: {
          reasoning_content: "先检查",
          tool_calls: [
            {
              index: 0,
              id: "call-1",
              type: "function",
              function: { name: "read_", arguments: '{"path":"' },
            },
          ],
        },
        finish_reason: null,
      },
    ],
  });
  accumulator.consume({
    choices: [
      {
        index: 0,
        delta: {
          reasoning_content: "文件",
          tool_calls: [
            {
              index: 0,
              function: { name: "fixture_file", arguments: 'src/math.ts"}' },
            },
          ],
        },
        finish_reason: "tool_calls",
      },
    ],
    usage: { total_tokens: 42 },
  });

  assert.deepEqual(accumulator.complete(), {
    message: {
      role: "assistant",
      content: null,
      reasoning_content: "先检查文件",
      tool_calls: [
        {
          id: "call-1",
          type: "function",
          function: {
            name: "read_fixture_file",
            arguments: '{"path":"src/math.ts"}',
          },
        },
      ],
    },
    finishReason: "tool_calls",
    usage: { total_tokens: 42 },
    responseId: "response-1",
  });
});

test("工具参数不是有效 JSON 时拒绝完成", () => {
  const accumulator = new ChatStreamAccumulator();
  accumulator.consume({
    choices: [
      {
        index: 0,
        delta: {
          tool_calls: [
            {
              index: 0,
              id: "call-1",
              function: { name: "read_fixture_file", arguments: "{" },
            },
          ],
        },
        finish_reason: "tool_calls",
      },
    ],
  });

  assert.throws(() => accumulator.complete(), SyntaxError);
});
