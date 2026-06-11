import assert from "node:assert/strict";
import test from "node:test";

import { DesktopSessionController } from "../src/index.js";
import { FakeRuntimeClient } from "./fake-runtime.js";

test("桌面会话服务连接 Runtime 并以默认模型启动首个任务", async () => {
  const runtime = new FakeRuntimeClient();
  const session = new DesktopSessionController(runtime);

  await session.connect();
  await session.startTask({
    text: "修复失败测试",
    projectPath: "D:\\project",
    model: "mimo-v2.5",
    sandbox: "workspace-write",
  });

  assert.equal(session.getSnapshot().connection, "ready");
  assert.equal(session.getSnapshot().threadId, "thread-1");
  assert.equal(session.getSnapshot().turnId, "turn-1");
  assert.equal(session.getSnapshot().timeline[0]?.content, "修复失败测试");
  assert.deepEqual(runtime.threadStarts[0], {
    cwd: "D:\\project",
    model: "mimo-v2.5",
    modelProvider: "mimo",
    approvalPolicy: "on-request",
    sandbox: "workspace-write",
  });
});

test("桌面会话服务投影流式文本、推理、命令、Diff 与完成状态", async () => {
  const runtime = new FakeRuntimeClient();
  const session = new DesktopSessionController(runtime);
  await session.connect();

  runtime.emitNotification({
    method: "turn/started",
    params: { turn: { id: "turn-2", status: "inProgress" } },
  });
  runtime.emitNotification({
    method: "item/reasoning/textDelta",
    params: { itemId: "reasoning-1", delta: "检查项目结构。" },
  });
  runtime.emitNotification({
    method: "item/agentMessage/delta",
    params: { itemId: "message-1", delta: "找到问题" },
  });
  runtime.emitNotification({
    method: "item/agentMessage/delta",
    params: { itemId: "message-1", delta: "并已修复。" },
  });
  runtime.emitNotification({
    method: "item/commandExecution/outputDelta",
    params: { itemId: "command-1", delta: "14 tests passed" },
  });
  runtime.emitNotification({
    method: "turn/diff/updated",
    params: { diff: "+ return left + right;" },
  });
  runtime.emitNotification({
    method: "turn/completed",
    params: { turn: { id: "turn-2", status: "completed" } },
  });

  const state = session.getSnapshot();
  assert.equal(state.turnStatus, "completed");
  assert.equal(state.timeline.find((item) => item.id === "message-1")?.content, "找到问题并已修复。");
  assert.equal(state.timeline.find((item) => item.id === "reasoning-1")?.kind, "reasoning");
  assert.equal(state.timeline.find((item) => item.id === "command-1")?.kind, "command");
  assert.equal(state.diff, "+ return left + right;");
});

test("桌面会话服务展示并回复 Runtime 审批请求", async () => {
  const runtime = new FakeRuntimeClient();
  const session = new DesktopSessionController(runtime);
  await session.connect();

  runtime.emitRequest({
    id: "approval-1",
    method: "item/commandExecution/requestApproval",
    params: {
      itemId: "command-1",
      command: "npm test",
      reason: "需要运行验证",
    },
  });
  assert.equal(session.getSnapshot().approvals[0]?.detail, "npm test");

  await session.resolveApproval("approval-1", "accept");

  assert.deepEqual(runtime.responses, [{ id: "approval-1", result: { decision: "accept" } }]);
  assert.equal(session.getSnapshot().approvals.length, 0);
  assert.equal(session.getSnapshot().timeline.at(-1)?.title, "已批准操作");
});

test("普通轮次错误保留 Runtime 连接，切换项目时创建新线程", async () => {
  const runtime = new FakeRuntimeClient();
  const session = new DesktopSessionController(runtime);
  await session.connect();
  await session.startTask({
    text: "第一个任务",
    projectPath: "D:\\project-a",
    model: "mimo-v2.5",
    sandbox: "workspace-write",
  });
  runtime.emitNotification({
    method: "error",
    params: { error: { message: "Provider 暂时不可用" } },
  });

  assert.equal(session.getSnapshot().connection, "ready");
  assert.equal(session.getSnapshot().turnStatus, "failed");

  await session.startTask({
    text: "第二个任务",
    projectPath: "D:\\project-b",
    model: "mimo-v2.5",
    sandbox: "read-only",
  });

  assert.equal(runtime.threadStarts.length, 2);
  assert.equal(runtime.threadStarts[1]?.cwd, "D:\\project-b");
});

test("单条协议诊断不会立即锁死已连接会话", async () => {
  const runtime = new FakeRuntimeClient();
  const session = new DesktopSessionController(runtime);
  await session.connect();

  runtime.emitProtocolError("Runtime emitted invalid JSON");

  assert.equal(session.getSnapshot().connection, "ready");
  assert.equal(session.getSnapshot().timeline.at(-1)?.title, "Runtime 协议异常");
});
