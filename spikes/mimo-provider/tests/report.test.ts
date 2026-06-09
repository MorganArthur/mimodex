import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCompletionProbeReport,
  buildCancellationProbeReport,
  buildNegativeReplayProbeReport,
  buildRecoveryProbeReport,
  buildResumeProbeReport,
  buildToolLoopProbeReport,
} from "../src/report.js";

test("脱敏报告只保存能力证据，不保存回答与推理正文", () => {
  const report = buildCompletionProbeReport("https://api.example/v1", "mimo-v2.5", {
    message: {
      role: "assistant",
      content: "最终回答秘密",
      reasoning_content: "推理正文秘密",
    },
    responseId: "response-1",
    finishReason: "stop",
    usage: { total_tokens: 10 },
  });
  const serialized = JSON.stringify(report);

  assert.equal(report.evidence.hasReasoningContent, true);
  assert.equal(report.evidence.hasTextContent, true);
  assert.equal(report.evidence.reasoningContentLength, 6);
  assert.equal(report.evidence.textContentLength, 6);
  assert.doesNotMatch(serialized, /最终回答秘密|推理正文秘密/);
});

test("负向重放报告只记录预期 400 结构", () => {
  const report = buildNegativeReplayProbeReport({
    baseUrl: "https://api.example/v1",
    model: "mimo-v2.5",
    mode: "omit",
    modifiedReasoningMessageCount: 3,
    historicalToolCallCount: 2,
    requestAccepted: false,
    observedStatus: 400,
    observedCategory: "invalid_request",
  });
  assert.equal(report.outcome, "observed");
  assert.equal(report.evidence.officialExpectationMatched, true);
});

test("取消报告要求观察到取消且后续请求成功", () => {
  const report = buildCancellationProbeReport({
    baseUrl: "https://api.example/v1",
    model: "mimo-v2.5",
    streamEventObservedBeforeCancel: true,
    cancellationObserved: true,
    cancellationCategory: "cancelled",
    followUpRequestSucceeded: true,
    followUpFinishReason: "stop",
    followUpResponseId: "response-2",
  });
  assert.equal(report.outcome, "pass");
});

test("恢复场景报告识别错误代码和重复工具调用", () => {
  const report = buildRecoveryProbeReport("https://api.example/v1", "mimo-v2.5", "denial", {
    messages: [
      { role: "user", content: "秘密" },
      {
        role: "assistant",
        content: null,
        reasoning_content: "秘密",
        tool_calls: [
          {
            id: "call-1",
            type: "function",
            function: {
              name: "request_restricted_write",
              arguments: '{"path":"../outside.txt"}',
            },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "call-1",
        content: '{"error":"permission_denied","retryable":false}',
      },
      { role: "assistant", content: "已停止", reasoning_content: "理解拒绝" },
    ],
    completions: [
      {
        message: {
          role: "assistant",
          content: null,
          reasoning_content: "秘密",
          tool_calls: [
            {
              id: "call-1",
              type: "function",
              function: {
                name: "request_restricted_write",
                arguments: '{"path":"../outside.txt"}',
              },
            },
          ],
        },
        finishReason: "tool_calls",
      },
      {
        message: { role: "assistant", content: "已停止", reasoning_content: "理解拒绝" },
        finishReason: "stop",
      },
    ],
  });

  assert.equal(report.evidence.expectedErrorObserved, true);
  assert.equal(report.evidence.toolRepeated, false);
  assert.doesNotMatch(JSON.stringify(report), /秘密|\.\.\/outside/);
});

test("恢复报告仅保存新增消息和请求统计", () => {
  const report = buildResumeProbeReport("https://api.example/v1", "mimo-v2.5", 3, {
    messages: [
      { role: "user", content: "旧消息秘密" },
      { role: "assistant", content: "旧回答秘密", reasoning_content: "旧推理秘密" },
      { role: "user", content: "跟进问题秘密" },
      { role: "assistant", content: "新回答秘密", reasoning_content: "新推理秘密" },
    ],
    completions: [
      {
        message: {
          role: "assistant",
          content: "新回答秘密",
          reasoning_content: "新推理秘密",
        },
        finishReason: "stop",
        responseId: "response-resume",
        usage: { total_tokens: 30 },
      },
    ],
  });
  const serialized = JSON.stringify(report);

  assert.equal(report.evidence.messageCountBeforeResume, 3);
  assert.equal(report.evidence.messageCountAfterResume, 4);
  assert.equal(report.evidence.addedAssistantMessageCount, 1);
  assert.equal(report.evidence.addedReasoningMessageCount, 1);
  assert.doesNotMatch(serialized, /秘密/);
});

test("工具循环报告保存调用关系和用量，不保存正文与参数", () => {
  const report = buildToolLoopProbeReport("https://api.example/v1", "mimo-v2.5", {
    messages: [
      { role: "user", content: "用户正文秘密" },
      {
        role: "assistant",
        content: null,
        reasoning_content: "推理正文秘密",
        tool_calls: [
          {
            id: "call-1",
            type: "function",
            function: { name: "read_fixture_file", arguments: '{"path":"秘密"}' },
          },
        ],
      },
      { role: "tool", tool_call_id: "call-1", content: "工具结果秘密" },
      {
        role: "assistant",
        content: "最终回答秘密",
        reasoning_content: "最终推理秘密",
      },
    ],
    completions: [
      {
        message: {
          role: "assistant",
          content: null,
          reasoning_content: "推理正文秘密",
          tool_calls: [
            {
              id: "call-1",
              type: "function",
              function: { name: "read_fixture_file", arguments: '{"path":"秘密"}' },
            },
          ],
        },
        finishReason: "tool_calls",
        responseId: "response-1",
        usage: { total_tokens: 10 },
      },
      {
        message: {
          role: "assistant",
          content: "最终回答秘密",
          reasoning_content: "最终推理秘密",
        },
        finishReason: "stop",
        responseId: "response-2",
        usage: { total_tokens: 20 },
      },
    ],
  });
  const serialized = JSON.stringify(report);

  assert.equal(report.evidence.toolCallCount, 1);
  assert.equal(report.evidence.maxToolCallsInSingleAssistant, 1);
  assert.equal(report.evidence.toolResultCount, 1);
  assert.equal(report.evidence.toolCallIdsMatchResults, true);
  assert.deepEqual(report.evidence.finishReasons, ["tool_calls", "stop"]);
  assert.doesNotMatch(serialized, /秘密|arguments|用户正文|工具结果/);
});
