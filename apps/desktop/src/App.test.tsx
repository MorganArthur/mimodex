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
import { DesktopRoot } from "./DesktopRoot.js";
import type { CredentialService, CredentialStatus } from "./credentials.js";

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

  it("未配置凭据时先完成安全存储，再创建 Runtime 会话", async () => {
    const credentials = new FakeCredentialService(false);
    const runtime = new UiRuntime();
    const createSession = () => new DesktopSessionController(runtime);
    const user = userEvent.setup();
    render(<DesktopRoot credentialService={credentials} createSession={createSession} />);

    expect(await screen.findByText("连接你的 MiMo API")).toBeTruthy();
    expect(runtime.initializeCount).toBe(0);

    await user.type(screen.getByLabelText("MiMo API Key"), "test-mimo-key");
    await user.click(screen.getByRole("button", { name: "保存并重启 Mimodex" }));

    await waitFor(() => expect(credentials.savedKeys).toEqual(["test-mimo-key"]));
    await waitFor(() => expect(credentials.restartCount).toBe(1));
    await waitFor(() => expect(runtime.initializeCount).toBe(1));
  });

  it("可以从左下角设置入口管理已保存凭据", async () => {
    const credentials = new FakeCredentialService(true);
    const runtime = new UiRuntime();
    const createSession = () => new DesktopSessionController(runtime);
    const user = userEvent.setup();
    render(<DesktopRoot credentialService={credentials} createSession={createSession} />);

    await waitFor(() => expect(screen.getAllByText("Runtime 已连接").length).toBeGreaterThan(0));
    await user.click(screen.getByRole("button", { name: "打开设置" }));

    expect(screen.getByRole("dialog", { name: "MiMo 设置" })).toBeTruthy();
    expect(screen.getByText("已安全保存")).toBeTruthy();
  });
});

class UiRuntime implements RuntimeClientPort {
  initializeCount = 0;
  readonly turnStarts: TurnStartParams[] = [];
  readonly responses: Array<{ id: RequestId; result: JsonValue | undefined }> = [];
  readonly #notifications = new Set<(notification: ServerNotification) => void>();
  readonly #requests = new Set<(request: ServerRequest) => void>();

  async initialize(): Promise<InitializeResponse> {
    this.initializeCount += 1;
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

class FakeCredentialService implements CredentialService {
  readonly savedKeys: string[] = [];
  restartCount = 0;
  #status: CredentialStatus;

  constructor(configured: boolean) {
    this.#status = {
      configured,
      source: configured ? "windowsCredentialManager" : "missing",
      storage: "Windows 凭据管理器",
    };
  }

  async getStatus(): Promise<CredentialStatus> {
    return this.#status;
  }

  async save(apiKey: string): Promise<CredentialStatus> {
    this.savedKeys.push(apiKey);
    this.#status = { ...this.#status, configured: true, source: "windowsCredentialManager" };
    return this.#status;
  }

  async delete(): Promise<CredentialStatus> {
    this.#status = { ...this.#status, configured: false, source: "missing" };
    return this.#status;
  }

  async restart(): Promise<void> {
    this.restartCount += 1;
  }
}
