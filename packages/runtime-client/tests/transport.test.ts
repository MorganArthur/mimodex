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
  let unsubscribed = 0;
  const unsubscribe = (): Unsubscribe => () => {
    unsubscribed += 1;
  };
  const process: RuntimeProcessPort = {
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
  assert.equal(unsubscribed, 3);
  assert.equal(killed, true);
});
