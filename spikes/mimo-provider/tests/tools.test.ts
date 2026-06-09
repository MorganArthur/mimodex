import assert from "node:assert/strict";
import test from "node:test";
import { executeFixtureTool, executeRecoveryTool } from "../src/tools.js";

test("允许读取 Fixture 内文件", async () => {
  const result = JSON.parse(
    await executeFixtureTool({
      id: "call-1",
      type: "function",
      function: {
        name: "read_fixture_file",
        arguments: '{"path":"src/math.ts"}',
      },
    }),
  ) as { content: string };

  assert.match(result.content, /return left - right/);
});

test("拒绝恢复工具返回不可重试的结构化拒绝", async () => {
  const result = JSON.parse(
    await executeRecoveryTool("denial", {
      id: "call-1",
      type: "function",
      function: {
        name: "request_restricted_write",
        arguments: '{"path":"../outside.txt"}',
      },
    }),
  ) as { error: string; retryable: boolean };

  assert.equal(result.error, "permission_denied");
  assert.equal(result.retryable, false);
});

test("失败恢复工具返回不可重试的结构化执行失败", async () => {
  const result = JSON.parse(
    await executeRecoveryTool("failure", {
      id: "call-1",
      type: "function",
      function: {
        name: "run_failing_check",
        arguments: '{"name":"synthetic-check"}',
      },
    }),
  ) as { error: string; retryable: boolean; exitCode: number };

  assert.equal(result.error, "tool_execution_failed");
  assert.equal(result.retryable, false);
  assert.equal(result.exitCode, 1);
});

test("拒绝路径穿越", async () => {
  await assert.rejects(
    executeFixtureTool({
      id: "call-1",
      type: "function",
      function: {
        name: "read_fixture_file",
        arguments: '{"path":"../../package.json"}',
      },
    }),
    /拒绝读取/,
  );
});

test("未知工具返回结构化拒绝", async () => {
  const result = JSON.parse(
    await executeFixtureTool({
      id: "call-1",
      type: "function",
      function: { name: "run_shell", arguments: "{}" },
    }),
  ) as { error: string };

  assert.equal(result.error, "tool_not_allowed");
});
