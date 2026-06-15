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
  assert.equal(typeof session.getSnapshot().timeline[0]?.startedAt, "number");
  assert.equal(runtime.threadStarts[0]?.cwd, "D:\\project");
  assert.equal(runtime.threadStarts[0]?.model, "mimo-v2.5");
  assert.equal(runtime.threadStarts[0]?.modelProvider, "mimo");
  assert.equal(runtime.threadStarts[0]?.approvalPolicy, "on-request");
  assert.equal(runtime.threadStarts[0]?.sandbox, "workspace-write");
  assert.match(runtime.threadStarts[0]?.baseInstructions ?? "", /You are MiMo.*Mimodex/s);
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
    method: "thread/tokenUsage/updated",
    params: {
      tokenUsage: {
        total: {
          inputTokens: 120,
          cachedInputTokens: 20,
          outputTokens: 30,
          reasoningOutputTokens: 10,
          totalTokens: 150,
        },
        modelContextWindow: 131072,
      },
    },
  });
  runtime.emitNotification({
    method: "turn/completed",
    params: { turn: { id: "turn-2", status: "completed" } },
  });

  const state = session.getSnapshot();
  assert.equal(state.turnStatus, "completed");
  assert.equal(state.timeline.find((item) => item.id === "message-1")?.content, "找到问题并已修复。");
  assert.equal(state.timeline.find((item) => item.id === "message-1")?.status, "completed");
  assert.equal(state.timeline.find((item) => item.id === "reasoning-1")?.kind, "reasoning");
  assert.equal(state.timeline.find((item) => item.id === "reasoning-1")?.status, "completed");
  assert.equal(state.timeline.find((item) => item.id === "command-1")?.kind, "command");
  assert.equal(state.timeline.find((item) => item.id === "command-1")?.status, "completed");
  assert.equal(state.diff, "+ return left + right;");
  assert.deepEqual(state.tokenUsage, {
    inputTokens: 120,
    cachedInputTokens: 20,
    outputTokens: 30,
    reasoningOutputTokens: 10,
    totalTokens: 150,
    contextWindow: 131072,
  });
});

test("轮次完成时记录用户请求与输出的真实处理时间", async () => {
  const runtime = new FakeRuntimeClient();
  const session = new DesktopSessionController(runtime);
  await session.connect();
  await session.startTask({
    text: "检查处理时间",
    projectPath: "D:\\project",
    model: "mimo-v2.5",
    sandbox: "workspace-write",
  });
  runtime.emitNotification({
    method: "item/agentMessage/delta",
    params: { itemId: "message-duration", delta: "完成。" },
  });
  runtime.emitNotification({
    method: "turn/completed",
    params: { turn: { id: "turn-1", status: "completed" } },
  });

  const [user, assistant] = session.getSnapshot().timeline;
  assert.equal(typeof user?.startedAt, "number");
  assert.equal(typeof user?.completedAt, "number");
  assert.equal(typeof assistant?.startedAt, "number");
  assert.equal(typeof assistant?.completedAt, "number");
  assert.ok((user?.completedAt ?? 0) >= (user?.startedAt ?? Number.MAX_SAFE_INTEGER));
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
      cwd: "D:\\project",
      grantRoot: "D:\\project",
      networkAccess: true,
    },
  });
  assert.equal(session.getSnapshot().approvals[0]?.detail, "npm test");
  assert.equal(session.getSnapshot().approvals[0]?.cwd, "D:\\project");
  assert.equal(session.getSnapshot().approvals[0]?.boundary, "D:\\project");
  assert.equal(session.getSnapshot().approvals[0]?.network, true);

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
  assert.equal(session.getSnapshot().structuredError?.category, "provider");

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
  assert.equal(session.getSnapshot().structuredError?.category, "protocol");
});

test("恢复历史线程后继续使用同一个 Runtime 线程", async () => {
  const runtime = new FakeRuntimeClient();
  const session = new DesktopSessionController(runtime);
  await session.connect();

  await session.resumeThread({
    threadId: "thread-history",
    projectPath: "D:\\project",
    model: "mimo-v2.5-pro",
    sandbox: "read-only",
    turnStatus: "completed",
    timeline: [
      { id: "user-history", kind: "user", title: "你", content: "检查历史", status: null },
    ],
    diff: "+ restored",
  });

  assert.equal(runtime.threadResumes[0]?.threadId, "thread-history");
  assert.equal(runtime.threadResumes[0]?.model, "mimo-v2.5-pro");
  assert.equal(runtime.threadResumes[0]?.modelProvider, "mimo");
  assert.equal(runtime.threadResumes[0]?.cwd, "D:\\project");
  assert.equal(runtime.threadResumes[0]?.approvalPolicy, "on-request");
  assert.equal(runtime.threadResumes[0]?.sandbox, "read-only");
  assert.match(runtime.threadResumes[0]?.baseInstructions ?? "", /You are MiMo.*Mimodex/s);
  assert.equal(session.getSnapshot().threadId, "thread-history");
  assert.equal(session.getSnapshot().sandbox, "read-only");
  assert.equal(session.getSnapshot().timeline[0]?.content, "检查历史");

  await session.startTask({
    text: "继续处理",
    projectPath: "D:\\project",
    model: "mimo-v2.5-pro",
    sandbox: "read-only",
  });

  assert.equal(runtime.threadStarts.length, 0);
  assert.equal(runtime.turnStarts.at(-1)?.threadId, "thread-history");
});

test("恢复历史线程时立即展示本地投影，并在 Runtime 失败后回滚", async () => {
  const runtime = new FakeRuntimeClient();
  const session = new DesktopSessionController(runtime);
  await session.connect();
  runtime.resumeError = new Error("resume failed");

  const resume = session.resumeThread({
    threadId: "thread-history",
    projectPath: "D:\\project",
    model: "mimo-v2.5",
    sandbox: "workspace-write",
    turnStatus: "completed",
    timeline: [
      { id: "user-history", kind: "user", title: "你", content: "立即展示", status: null },
    ],
    diff: "",
  });

  assert.equal(session.getSnapshot().threadId, "thread-history");
  assert.equal(session.getSnapshot().timeline[0]?.content, "立即展示");
  await assert.rejects(resume, /resume failed/);
  assert.equal(session.getSnapshot().threadId, null);
  assert.deepEqual(session.getSnapshot().timeline, []);
});

test("新建线程会清空当前投影但保留项目上下文", async () => {
  const runtime = new FakeRuntimeClient();
  const session = new DesktopSessionController(runtime);
  await session.connect();
  await session.startTask({
    text: "第一个任务",
    projectPath: "D:\\project",
    model: "mimo-v2.5",
    sandbox: "workspace-write",
  });

  runtime.emitNotification({
    method: "turn/completed",
    params: { turn: { id: "turn-1", status: "completed" } },
  });
  session.newThread("D:\\project");

  assert.equal(session.getSnapshot().threadId, null);
  assert.equal(session.getSnapshot().projectPath, "D:\\project");
  assert.deepEqual(session.getSnapshot().timeline, []);
  assert.equal(session.getSnapshot().tokenUsage, null);
});

test("归档与恢复归档会调用 Runtime 权威线程 API", async () => {
  const runtime = new FakeRuntimeClient();
  const session = new DesktopSessionController(runtime);
  await session.connect();

  await session.setThreadArchived("thread-history", true);
  await session.setThreadArchived("thread-history", false);

  assert.deepEqual(runtime.threadArchives, [{ threadId: "thread-history" }]);
  assert.deepEqual(runtime.threadUnarchives, [{ threadId: "thread-history" }]);
});

test("线程建立前暂存原始事件并在获得线程 ID 后按序释放", () => {
  const runtime = new FakeRuntimeClient();
  const session = new DesktopSessionController(runtime);
  const events: Array<{ threadId: string; sequence: number; method: string | null }> = [];
  session.subscribeRuntimeEvents((event) =>
    events.push({
      threadId: event.threadId,
      sequence: event.protocol.sequence,
      method: event.protocol.method,
    }),
  );

  runtime.emitProtocolEvent({
    sequence: 1,
    direction: "clientToRuntime",
    kind: "request",
    method: "thread/start",
    requestId: 1,
    threadId: null,
    message: { id: 1, method: "thread/start", params: { cwd: "D:\\project" } },
  });
  runtime.emitProtocolEvent({
    sequence: 2,
    direction: "runtimeToClient",
    kind: "response",
    method: "thread/start",
    requestId: 1,
    threadId: "thread-raw",
    message: { id: 1, result: { thread: { id: "thread-raw" } } },
  });

  assert.deepEqual(events, [
    { threadId: "thread-raw", sequence: 1, method: "thread/start" },
    { threadId: "thread-raw", sequence: 2, method: "thread/start" },
  ]);
});
