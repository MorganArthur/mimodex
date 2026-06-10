import assert from "node:assert/strict";
import test from "node:test";

import { MimodexRuntimeClient } from "../src/index.js";
import { FakeTransport } from "./fake-transport.js";

test("Mimodex Runtime 客户端完成握手并调用首批 thread/turn API", async () => {
  const transport = new FakeTransport();
  const methods: string[] = [];
  transport.onWrite = (line) => {
    const message = JSON.parse(line) as { id?: number; method?: string };
    if (!message.method) {
      return;
    }
    methods.push(message.method);
    if (message.id === undefined) {
      return;
    }
    const result =
      message.method === "initialize"
        ? {
            userAgent: "mimodex-test",
            codexHome: "C:\\mimodex",
            platformFamily: "windows",
            platformOs: "windows",
          }
        : message.method === "thread/start" || message.method === "thread/resume"
          ? {
              thread: { id: "thread-1" },
              model: "mimo-v2.5",
              modelProvider: "mimo",
              cwd: "D:\\project",
            }
          : message.method === "turn/start"
            ? { turn: { id: "turn-1", status: "inProgress" } }
            : {};
    transport.emitStdout(`${JSON.stringify({ id: message.id, result })}\n`);
  };

  const client = new MimodexRuntimeClient(transport, {
    clientVersion: "0.1.0",
    experimentalApi: true,
  });
  const initialized = await client.initialize();
  const thread = await client.startThread({
    cwd: "D:\\project",
    model: "mimo-v2.5",
    modelProvider: "mimo",
  });
  await client.startTurn({
    threadId: thread.thread.id,
    input: [{ type: "text", text: "修复测试", textElements: [] }],
  });
  await client.interruptTurn({ threadId: "thread-1", turnId: "turn-1" });
  await client.resumeThread({ threadId: "thread-1" });

  assert.equal(initialized.platformOs, "windows");
  assert.deepEqual(methods, [
    "initialize",
    "initialized",
    "thread/start",
    "turn/start",
    "turn/interrupt",
    "thread/resume",
  ]);
  const initialize = JSON.parse(transport.writes[0] ?? "");
  assert.equal(initialize.params.clientInfo.name, "mimodex_desktop");
  assert.equal(initialize.params.capabilities.experimentalApi, true);
});

test("初始化前拒绝发送 Runtime 业务请求", async () => {
  const client = new MimodexRuntimeClient(new FakeTransport(), {
    clientVersion: "0.1.0",
  });

  await assert.rejects(() => client.startThread({}), /not initialized/);
});
