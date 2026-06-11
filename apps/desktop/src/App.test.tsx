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
import type { ProjectService, ProjectState, ProjectSummary } from "./projects.js";

afterEach(cleanup);

describe("Mimodex 桌面壳", () => {
  it("默认展示 mimo-v2.5，并将 Pro 放入高级模型选择", async () => {
    const runtime = new UiRuntime();
    const user = userEvent.setup();
    renderApp(runtime);

    await waitFor(() => expect(screen.getAllByText("Runtime 已连接").length).toBeGreaterThan(0));
    expect(screen.getAllByText("mimo-v2.5").length).toBeGreaterThan(0);

    await user.click(screen.getByText("mimo-v2.5", { selector: "summary strong" }));
    expect(screen.getByText("高级模型")).toBeTruthy();
    expect(screen.getByText("mimo-v2.5-pro")).toBeTruthy();
  });

  it("提交任务并处理命令审批", async () => {
    const runtime = new UiRuntime();
    const user = userEvent.setup();
    renderApp(runtime);
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
    render(
      <DesktopRoot
        credentialService={credentials}
        createSession={createSession}
        projectService={new FakeProjectService()}
      />,
    );

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
    render(
      <DesktopRoot
        credentialService={credentials}
        createSession={createSession}
        projectService={new FakeProjectService()}
      />,
    );

    await waitFor(() => expect(screen.getAllByText("Runtime 已连接").length).toBeGreaterThan(0));
    await user.click(screen.getByRole("button", { name: "打开设置" }));

    expect(screen.getByRole("dialog", { name: "MiMo 设置" })).toBeTruthy();
    expect(screen.getByText("已安全保存")).toBeTruthy();
  });

  it("添加本地项目后使用所选路径提交任务", async () => {
    const credentials = new FakeCredentialService(true);
    const projects = new FakeProjectService([]);
    const runtime = new UiRuntime();
    const user = userEvent.setup();
    render(
      <DesktopRoot
        credentialService={credentials}
        createSession={() => new DesktopSessionController(runtime)}
        projectService={projects}
      />,
    );

    expect(await screen.findByText(/先选择项目/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "添加本地项目" }));
    expect(await screen.findByRole("heading", { name: "fixture", level: 1 })).toBeTruthy();

    await user.type(screen.getByLabelText("任务内容"), "检查项目");
    await user.click(screen.getByRole("button", { name: /开始任务/ }));

    await waitFor(() => expect(runtime.threadStarts.at(-1)?.cwd).toBe("D:\\projects\\fixture"));
  });

  it("切换项目会更新后续任务的工作目录", async () => {
    const projects = [fixtureProject(), secondProject()];
    const projectService = new FakeProjectService(projects);
    const runtime = new UiRuntime();
    const user = userEvent.setup();
    render(
      <DesktopRoot
        credentialService={new FakeCredentialService(true)}
        createSession={() => new DesktopSessionController(runtime)}
        projectService={projectService}
      />,
    );
    await waitFor(() => expect(screen.getAllByText("Runtime 已连接").length).toBeGreaterThan(0));

    await user.click(screen.getByRole("button", { name: /second/ }));
    await user.type(screen.getByLabelText("任务内容"), "检查第二个项目");
    await user.click(screen.getByRole("button", { name: /开始任务/ }));

    await waitFor(() => expect(runtime.threadStarts.at(-1)?.cwd).toBe("D:\\projects\\second"));
  });

  it("项目文件夹不可用时禁止启动任务", async () => {
    const runtime = new UiRuntime();
    const unavailableProject = { ...fixtureProject(), available: false };
    const user = userEvent.setup();
    renderApp(runtime, [unavailableProject], unavailableProject);

    expect(await screen.findByText(/找不到 fixture/)).toBeTruthy();
    await user.type(screen.getByLabelText("任务内容"), "不应提交");

    expect((screen.getByRole("button", { name: /开始任务/ }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(runtime.threadStarts).toHaveLength(0);
  });
});

function renderApp(
  runtime: UiRuntime,
  projects: ProjectSummary[] = [fixtureProject()],
  currentProject: ProjectSummary | null = projects[0] ?? null,
) {
  return render(
    <App
      currentProject={currentProject}
      onAddProject={() => undefined}
      onRefreshProject={() => undefined}
      onSelectProject={() => undefined}
      projectBusy={false}
      projectError={null}
      projects={projects}
      session={new DesktopSessionController(runtime)}
    />,
  );
}

class UiRuntime implements RuntimeClientPort {
  initializeCount = 0;
  readonly threadStarts: ThreadStartParams[] = [];
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
    this.threadStarts.push(params);
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

class FakeProjectService implements ProjectService {
  #state: ProjectState;

  constructor(projects: ProjectSummary[] = [fixtureProject()]) {
    this.#state = {
      projects,
      selectedProjectId: projects[0]?.id ?? null,
    };
  }

  async list(): Promise<ProjectState> {
    return this.#state;
  }

  async pickDirectory(): Promise<string | null> {
    return "D:\\projects\\fixture";
  }

  async add(_path: string): Promise<ProjectState> {
    const project = fixtureProject();
    this.#state = { projects: [project], selectedProjectId: project.id };
    return this.#state;
  }

  async select(projectId: string): Promise<ProjectState> {
    this.#state = { ...this.#state, selectedProjectId: projectId };
    return this.#state;
  }

  async refresh(_projectId: string): Promise<ProjectState> {
    return this.#state;
  }
}

function fixtureProject(): ProjectSummary {
  return {
    id: "d:\\projects\\fixture",
    path: "D:\\projects\\fixture",
    name: "fixture",
    available: true,
    git: {
      isRepository: true,
      branch: "main",
      head: "abc1234",
      dirty: false,
      changedFiles: 0,
      untrackedFiles: 0,
    },
    lastOpenedAt: 2,
  };
}

function secondProject(): ProjectSummary {
  return {
    ...fixtureProject(),
    id: "d:\\projects\\second",
    path: "D:\\projects\\second",
    name: "second",
    git: { ...fixtureProject().git, branch: "feature/project-management", dirty: true, changedFiles: 2 },
    lastOpenedAt: 1,
  };
}
