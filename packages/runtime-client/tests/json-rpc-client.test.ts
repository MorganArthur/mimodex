import assert from "node:assert/strict";
import test from "node:test";

import {
  JsonRpcClient,
  JsonRpcResponseError,
  JsonRpcTimeoutError,
  RuntimeDisconnectedError,
  RuntimeProtocolError,
} from "../src/index.js";
import { FakeTransport } from "./fake-transport.js";

test("JSON-RPC 客户端关联乱序响应并转发通知", async () => {
  const transport = new FakeTransport();
  const client = new JsonRpcClient(transport);
  const notifications: string[] = [];
  const events: Array<{ sequence: number; direction: string; kind: string; method: string | null }> =
    [];
  client.onNotification((notification) => notifications.push(notification.method));
  client.onProtocolEvent(({ sequence, direction, kind, method }) =>
    events.push({ sequence, direction, kind, method }),
  );
  await client.start();

  const first = client.request<{ value: string }>("first");
  const second = client.request<{ value: string }>("second");
  transport.emitStdout(
    '{"id":2,"result":{"value":"two"}}\n{"method":"turn/started","params":{"turnId":"t1"}}\n',
  );
  transport.emitStdout('{"id":1,"result":{"value":"one"}}\n');

  assert.deepEqual(await second, { value: "two" });
  assert.deepEqual(await first, { value: "one" });
  assert.deepEqual(notifications, ["turn/started"]);
  assert.deepEqual(events, [
    { sequence: 1, direction: "clientToRuntime", kind: "request", method: "first" },
    { sequence: 2, direction: "clientToRuntime", kind: "request", method: "second" },
    { sequence: 3, direction: "runtimeToClient", kind: "response", method: "second" },
    { sequence: 4, direction: "runtimeToClient", kind: "notification", method: "turn/started" },
    { sequence: 5, direction: "runtimeToClient", kind: "response", method: "first" },
  ]);
});

test("JSON-RPC 客户端暴露服务端反向请求并可回复", async () => {
  const transport = new FakeTransport();
  const client = new JsonRpcClient(transport);
  const requests: string[] = [];
  const events: Array<{ direction: string; kind: string; method: string | null }> = [];
  client.onServerRequest((request) => requests.push(request.method));
  client.onProtocolEvent(({ direction, kind, method }) => events.push({ direction, kind, method }));
  await client.start();

  transport.emitStdout(
    '{"id":"approval-1","method":"item/commandExecution/requestApproval","params":{"command":"npm test"}}\n',
  );
  await client.respond("approval-1", { decision: "decline" });

  assert.deepEqual(requests, ["item/commandExecution/requestApproval"]);
  assert.deepEqual(JSON.parse(transport.writes[0] ?? ""), {
    id: "approval-1",
    result: { decision: "decline" },
  });
  assert.deepEqual(events, [
    {
      direction: "runtimeToClient",
      kind: "request",
      method: "item/commandExecution/requestApproval",
    },
    {
      direction: "clientToRuntime",
      kind: "response",
      method: "item/commandExecution/requestApproval",
    },
  ]);
});

test("JSON-RPC 错误响应映射为结构化异常", async () => {
  const transport = new FakeTransport();
  const client = new JsonRpcClient(transport);
  await client.start();

  const pending = client.request("thread/start");
  transport.emitStdout('{"id":1,"error":{"code":-32600,"message":"invalid"}}\n');

  await assert.rejects(pending, (error: unknown) => {
    assert.ok(error instanceof JsonRpcResponseError);
    assert.equal(error.code, -32600);
    return true;
  });
});

test("JSON-RPC 响应继承对应请求的线程上下文", async () => {
  const transport = new FakeTransport();
  const client = new JsonRpcClient(transport);
  const events: Array<{ method: string | null; threadId: string | null }> = [];
  client.onProtocolEvent(({ method, threadId }) => events.push({ method, threadId }));
  await client.start();

  const pending = client.request("thread/archive", { threadId: "thread-background" });
  transport.emitStdout('{"id":1,"result":{}}\n');
  await pending;

  assert.deepEqual(events, [
    { method: "thread/archive", threadId: "thread-background" },
    { method: "thread/archive", threadId: "thread-background" },
  ]);
});

test("Runtime 退出会拒绝全部待处理请求", async () => {
  const transport = new FakeTransport();
  const client = new JsonRpcClient(transport);
  await client.start();

  const pending = client.request("turn/start");
  transport.emitExit({ code: 7 });

  await assert.rejects(pending, RuntimeDisconnectedError);
  await assert.rejects(() => client.request("thread/start"), RuntimeDisconnectedError);
});

test("Runtime 退出前会处理最后一条无换行响应", async () => {
  const transport = new FakeTransport();
  const client = new JsonRpcClient(transport);
  await client.start();

  const pending = client.request<{ accepted: boolean }>("turn/start");
  transport.emitStdout('{"id":1,"result":{"accepted":true}}');
  transport.emitExit({ code: 0 });

  assert.deepEqual(await pending, { accepted: true });
});

test("Transport 启动失败后客户端仍可重试", async () => {
  class FailOnceTransport extends FakeTransport {
    attempts = 0;

    override async start(handlers: Parameters<FakeTransport["start"]>[0]): Promise<void> {
      this.attempts += 1;
      if (this.attempts === 1) {
        throw new Error("start failed");
      }
      await super.start(handlers);
    }
  }

  const transport = new FailOnceTransport();
  const client = new JsonRpcClient(transport);

  await assert.rejects(() => client.start(), /start failed/);
  await client.start();
  const pending = client.request<{ recovered: boolean }>("thread/start");
  transport.emitStdout('{"id":1,"result":{"recovered":true}}\n');

  assert.deepEqual(await pending, { recovered: true });
});

test("请求超时后清除关联状态且不影响后续请求", async () => {
  const transport = new FakeTransport();
  const client = new JsonRpcClient(transport);
  const errors: RuntimeProtocolError[] = [];
  client.onProtocolError((error) => errors.push(error));
  await client.start();

  await assert.rejects(() => client.request("slow", undefined, 1), JsonRpcTimeoutError);
  transport.emitStdout('{"id":1,"result":{}}\n');

  const next = client.request<{ ready: boolean }>("next");
  transport.emitStdout('{"id":2,"result":{"ready":true}}\n');

  assert.match(errors[0]?.message ?? "", /unknown request id/);
  assert.deepEqual(await next, { ready: true });
});

test("无效 JSON 与未知响应 ID 通过协议错误事件报告", async () => {
  const transport = new FakeTransport();
  const client = new JsonRpcClient(transport);
  const errors: RuntimeProtocolError[] = [];
  client.onProtocolError((error) => errors.push(error));
  await client.start();

  transport.emitStdout("not-json\n");
  transport.emitStdout('{"id":999,"result":{}}\n');

  assert.equal(errors.length, 2);
  assert.match(errors[0]?.message ?? "", /invalid JSON/);
  assert.match(errors[1]?.message ?? "", /unknown request id/);
});

test("底层解码异常保留具体原因", async () => {
  const transport = new FakeTransport();
  const client = new JsonRpcClient(transport);
  const errors: RuntimeProtocolError[] = [];
  client.onProtocolError((error) => errors.push(error));
  await client.start();

  transport.emitStdout([123, 125, 10] as unknown as Uint8Array);

  assert.match(errors[0]?.message ?? "", /Runtime protocol failure:/);
  assert.doesNotMatch(errors[0]?.message ?? "", /^Runtime protocol failure$/);
});
