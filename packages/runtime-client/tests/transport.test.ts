import assert from "node:assert/strict";
import test from "node:test";

import {
  ProcessRuntimeTransport,
  type RuntimeProcessPort,
  type Unsubscribe,
} from "../src/index.js";

test("进程 Transport 为每条 JSON 消息追加换行并释放监听器", async () => {
  const writes: string[] = [];
  let killed = false;
  let started = false;
  let unsubscribed = 0;
  const unsubscribe = (): Unsubscribe => () => {
    unsubscribed += 1;
  };
  const process: RuntimeProcessPort = {
    async start() {
      started = true;
    },
    async write(input) {
      writes.push(input);
    },
    async kill() {
      killed = true;
    },
    onStdout: unsubscribe,
    onStderr: unsubscribe,
    onExit: unsubscribe,
  };
  const transport = new ProcessRuntimeTransport(process);
  await transport.start({
    onStdout() {},
    onStderr() {},
    onExit() {},
  });

  await transport.writeLine('{"method":"initialized"}');
  await transport.close();

  assert.deepEqual(writes, ['{"method":"initialized"}\n']);
  assert.equal(started, true);
  assert.equal(unsubscribed, 3);
  assert.equal(killed, true);
});

test("进程启动失败时释放监听器并允许重试", async () => {
  let attempts = 0;
  let unsubscribed = 0;
  const unsubscribe = (): Unsubscribe => () => {
    unsubscribed += 1;
  };
  const process: RuntimeProcessPort = {
    async start() {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("spawn failed");
      }
    },
    async write() {},
    async kill() {},
    onStdout: unsubscribe,
    onStderr: unsubscribe,
    onExit: unsubscribe,
  };
  const transport = new ProcessRuntimeTransport(process);
  const handlers = {
    onStdout() {},
    onStderr() {},
    onExit() {},
  };

  await assert.rejects(transport.start(handlers), /spawn failed/);
  assert.equal(unsubscribed, 3);

  await transport.start(handlers);
  assert.equal(attempts, 2);
});
