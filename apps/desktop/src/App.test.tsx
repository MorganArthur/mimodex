import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { DesktopSessionController } from "@mimodex/desktop-core";
import type {
  InitializeResponse,
  JsonValue,
  RequestId,
  RuntimeProtocolError,
  ServerNotification,
  ServerRequest,
  ThreadStartParams,
  ThreadStartResponse,
  TurnInterruptParams,
  TurnInterruptResponse,
  TurnStartParams,
  TurnStartResponse,
} from "@mimodex/runtime-client";
import type { RuntimeClientPort } from "@mimodex/desktop-core";
import { App } from "./App.js";

afterEach(cleanup);

describe("Mimodex 桌面壳", () => {
  it("默认展示 mimo-v2.5，并将 Pro 放入高级模型选择", async () => {
    const runtime = new UiRuntime();
    const user = userEvent.setup();
    render(<App session={new DesktopSessionController(runtime)} />);

    await waitFor(() => expect(screen.getAllByText("Runtime 已连接").length).toBeGreaterThan(0));
    expect(screen.getAllByText("mimo-v2.5").length).toBeGreaterThan(0);

    await user.click(screen.getByText("mimo-v2.5", { selector: "summary strong" }));
    expect(screen.getByText("高级模型")).toBeTruthy();
    expect(screen.getByText("mimo-v2.5-pro")).toBeTruthy();
  });

  it("提交任务并处理命令审批", async () => {
    const runtime = new UiRuntime();
    const user = userEvent.setup();
    render(<App session={new DesktopSessionController(runtime)} />);
    await waitFor(() => expect(screen.getAllByText("Runtime 已连接").length).toBeGreaterThan(0));

    await user.type(screen.getByLabelText("任务内容"), "修复失败测试");
    await user.click(screen.getByRole("button", { name: /开始任务/ }));
    await waitFor(() => expect(runtime.turnStarts.length).toBe(1));

    runtime.emitRequest({
      id: "approval-1",
      method: "item/commandExecution/requestApproval",
      params: { itemId: "command-1", command: "npm test", reason: "运行验证" },
    });
    expect(await screen.findByText("命令需要审批")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "允许一次" }));

    await waitFor(() =>
      expect(runtime.responses).toEqual([{ id: "approval-1", result: { decision: "accept" } }]),
    );
  });
});

class UiRuntime implements RuntimeClientPort {
  readonly turnStarts: TurnStartParams[] = [];
  readonly responses: Array<{ id: RequestId; result: JsonValue | undefined }> = [];
  readonly #notifications = new Set<(notification: ServerNotification) => void>();
  readonly #requests = new Set<(request: ServerRequest) => void>();

  async initialize(): Promise<InitializeResponse> {
    return {
      userAgent: "ui-test",
      codexHome: "C:\\mimodex",
      platformFamily: "windows",
      platformOs: "windows",
    };
  }

  async startThread(params: ThreadStartParams): Promise<ThreadStartResponse> {
    return {
      thread: { id: "thread-1" },
      model: params.model ?? "mimo-v2.5",
      modelProvider: "mimo",
      cwd: params.cwd ?? "D:\\project",
    };
  }

  async startTurn(params: TurnStartParams): Promise<TurnStartResponse> {
    this.turnStarts.push(params);
    return { turn: { id: "turn-1", status: "inProgress" } };
  }

  async interruptTurn(_params: TurnInterruptParams): Promise<TurnInterruptResponse> {
    return {};
  }

  onNotification(listener: (notification: ServerNotification) => void): () => void {
    this.#notifications.add(listener);
    return () => this.#notifications.delete(listener);
  }

  onServerRequest(listener: (request: ServerRequest) => void): () => void {
    this.#requests.add(listener);
    return () => this.#requests.delete(listener);
  }

  onProtocolError(_listener: (error: RuntimeProtocolError) => void): () => void {
    return () => undefined;
  }

  onExit(_listener: (details: { code?: number; signal?: string } | undefined) => void): () => void {
    return () => undefined;
  }

  async respond(id: RequestId, result?: JsonValue): Promise<void> {
    this.responses.push({ id, result });
  }

  async close(): Promise<void> {}

  emitRequest(request: ServerRequest): void {
    for (const listener of this.#requests) {
      listener(request);
    }
  }
}
