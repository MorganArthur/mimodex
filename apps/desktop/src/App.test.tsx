import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DesktopSessionController, type SessionRuntimeEvent } from "@mimodex/desktop-core";
import type {
  InitializeResponse,
  JsonValue,
  RequestId,
  RuntimeProtocolEvent,
  RuntimeProtocolError,
  ServerNotification,
  ServerRequest,
  ThreadArchiveParams,
  ThreadArchiveResponse,
  ThreadResumeParams,
  ThreadResumeResponse,
  ThreadStartParams,
  ThreadStartResponse,
  ThreadUnarchiveParams,
  ThreadUnarchiveResponse,
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
import {
  DEFAULT_APP_SETTINGS,
  normalizeSettings,
  type AppSettings,
  type ConnectionDiagnostic,
  type ConnectionDiagnosticInput,
  type SettingsService,
} from "./settings.js";
import type {
  ThreadActivityEvent,
  ThreadRecord,
  ThreadService,
  ThreadState,
} from "./threads.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Mimodex 桌面壳", () => {
  it("默认展示 mimo-v2.5，并将 Pro 放入高级模型选择", async () => {
    const runtime = new UiRuntime();
    const user = userEvent.setup();
    renderApp(runtime);

    await waitFor(() => expect(screen.getAllByText("Runtime 已连接").length).toBeGreaterThan(0));
    expect(screen.getAllByText("mimo-v2.5").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("模型选项").getAttribute("aria-hidden")).toBe("true");

    await user.click(screen.getByLabelText("模型"));
    expect(screen.getByLabelText("模型选项").getAttribute("aria-hidden")).toBe("false");
    expect(screen.getByText("高级模型")).toBeTruthy();
    expect(screen.getByText("mimo-v2.5-pro")).toBeTruthy();

    await user.click(screen.getByRole("option", { name: /mimo-v2.5-pro/ }));
    expect(screen.getByLabelText("模型选项").getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByLabelText("模型").textContent).toContain("mimo-v2.5-pro");
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
      params: {
        itemId: "command-1",
        command: "npm test",
        reason: "运行验证",
        cwd: "D:\\projects\\fixture",
        grantRoot: "D:\\projects\\fixture",
        networkAccess: false,
      },
    });
    expect(await screen.findByText("命令需要审批")).toBeTruthy();
    expect(screen.getAllByText("D:\\projects\\fixture").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("不需要")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "允许一次" }));

    await waitFor(() =>
      expect(runtime.responses).toEqual([{ id: "approval-1", result: { decision: "accept" } }]),
    );
  });

  it("回车发送任务，Shift 回车换行，输入法组合期间不发送", async () => {
    const runtime = new UiRuntime();
    const user = userEvent.setup();
    renderApp(runtime);
    await waitFor(() => expect(screen.getAllByText("Runtime 已连接").length).toBeGreaterThan(0));
    const textarea = screen.getByLabelText("任务内容") as HTMLTextAreaElement;

    await user.type(textarea, "第一行");
    await user.keyboard("{Shift>}{Enter}{/Shift}第二行");

    expect(textarea.value).toBe("第一行\n第二行");
    expect(runtime.turnStarts).toHaveLength(0);

    fireEvent.keyDown(textarea, { isComposing: true, key: "Enter" });
    expect(runtime.turnStarts).toHaveLength(0);

    fireEvent.keyDown(textarea, { key: "Enter" });
    fireEvent.keyDown(textarea, { key: "Enter" });
    await waitFor(() => expect(runtime.turnStarts).toHaveLength(1));
    expect(runtime.turnStarts[0]?.input[0]).toMatchObject({
      type: "text",
      text: "第一行\n第二行",
    });
    expect(textarea.value).toBe("");
  });

  it("以右侧用户气泡和左侧 AI、工具活动展示已完成轮次", async () => {
    const runtime = new UiRuntime();
    const user = userEvent.setup();
    renderApp(runtime);
    await waitFor(() => expect(screen.getAllByText("Runtime 已连接").length).toBeGreaterThan(0));

    await user.type(screen.getByLabelText("任务内容"), "检查项目");
    await user.click(screen.getByRole("button", { name: /开始任务/ }));
    runtime.emitNotification({
      method: "item/started",
      params: {
        item: {
          id: "command-layout",
          type: "commandExecution",
          command: "npm test",
          status: "inProgress",
        },
      },
    });
    runtime.emitNotification({
      method: "item/agentMessage/delta",
      params: { itemId: "assistant-layout", delta: "检查完成。" },
    });
    runtime.emitNotification({
      method: "turn/completed",
      params: { turn: { id: "turn-1", status: "completed" } },
    });

    expect(await screen.findByText("检查完成。")).toBeTruthy();
    expect(document.querySelector(".user-message")?.textContent).toContain("检查项目");
    expect(document.querySelector(".assistant-message")?.textContent).toContain("检查完成。");
    expect(document.querySelector(".timeline-activity")?.textContent).toContain("运行命令 · npm test");
    expect(screen.getByText(/^已处理 \d+s$/)).toBeTruthy();
    expect(document.querySelector(".entry-label")).toBeNull();
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
        settingsService={new FakeSettingsService()}
        threadService={new FakeThreadService()}
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

  it("诊断失败时不会保存无效凭据", async () => {
    const credentials = new FakeCredentialService(false);
    const settings = new FakeSettingsService();
    settings.diagnosticResult = {
      ok: false,
      category: "authentication",
      message: "认证失败",
      detail: "API Key 无效。",
      latencyMs: 30,
      statusCode: 401,
    };
    const user = userEvent.setup();
    render(
      <DesktopRoot
        credentialService={credentials}
        createSession={() => new DesktopSessionController(new UiRuntime())}
        projectService={new FakeProjectService()}
        settingsService={settings}
        threadService={new FakeThreadService()}
      />,
    );

    await user.type(await screen.findByLabelText("MiMo API Key"), "invalid-key");
    await user.click(screen.getByRole("button", { name: "保存并重启 Mimodex" }));

    expect(await screen.findByText("认证失败：API Key 无效。")).toBeTruthy();
    expect(credentials.savedKeys).toEqual([]);
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
        settingsService={new FakeSettingsService()}
        threadService={new FakeThreadService()}
      />,
    );

    await waitFor(() => expect(screen.getAllByText("Runtime 已连接").length).toBeGreaterThan(0));
    await user.click(screen.getByRole("button", { name: "打开设置" }));

    expect(screen.getByRole("dialog", { name: "MiMo 设置" })).toBeTruthy();
    expect(screen.getByText("已安全保存")).toBeTruthy();
  });

  it("持久化自定义端点与默认模型和权限", async () => {
    const credentials = new FakeCredentialService(true);
    const settings = new FakeSettingsService();
    const user = userEvent.setup();
    render(
      <DesktopRoot
        credentialService={credentials}
        createSession={() => new DesktopSessionController(new UiRuntime())}
        projectService={new FakeProjectService()}
        settingsService={settings}
        threadService={new FakeThreadService()}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "打开设置" }));
    await user.clear(screen.getByLabelText("API Base URL"));
    await user.type(screen.getByLabelText("API Base URL"), "https://gateway.example.com/v1/");
    await user.click(screen.getByLabelText("默认模型"));
    await user.click(screen.getByRole("option", { name: /mimo-v2.5-pro/ }));
    await user.click(screen.getByLabelText("默认权限"));
    await user.click(screen.getByRole("option", { name: /只读/ }));
    await user.click(screen.getByRole("button", { name: "保存默认设置并重启" }));

    await waitFor(() =>
      expect(settings.saved).toEqual([
        {
          apiBaseUrl: "https://gateway.example.com/v1",
          defaultModel: "mimo-v2.5-pro",
          defaultSandbox: "read-only",
        },
      ]),
    );
    expect(credentials.restartCount).toBe(1);
  });

  it("可在设置页诊断端点与已保存凭据", async () => {
    const settings = new FakeSettingsService();
    const user = userEvent.setup();
    render(
      <DesktopRoot
        credentialService={new FakeCredentialService(true)}
        createSession={() => new DesktopSessionController(new UiRuntime())}
        projectService={new FakeProjectService()}
        settingsService={settings}
        threadService={new FakeThreadService()}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "打开设置" }));
    await user.click(screen.getByRole("button", { name: "测试端点与已保存 Key" }));

    expect(await screen.findByText("测试连接成功。")).toBeTruthy();
    expect(settings.diagnosed).toHaveLength(1);
  });

  it("将完全访问设为默认权限前使用应用内确认框", async () => {
    const settings = new FakeSettingsService();
    const user = userEvent.setup();
    render(
      <DesktopRoot
        credentialService={new FakeCredentialService(true)}
        createSession={() => new DesktopSessionController(new UiRuntime())}
        projectService={new FakeProjectService()}
        settingsService={settings}
        threadService={new FakeThreadService()}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "打开设置" }));
    await user.click(screen.getByLabelText("默认权限"));
    await user.click(screen.getByRole("option", { name: /完全访问/ }));
    await user.click(screen.getByRole("button", { name: "保存默认设置并重启" }));

    expect(screen.getByRole("dialog", { name: "将完全访问设为默认权限？" })).toBeTruthy();
    expect(settings.saved).toEqual([]);

    await user.click(screen.getByRole("button", { name: "设为默认完全访问" }));
    await waitFor(() =>
      expect(settings.saved).toEqual([
        {
          ...DEFAULT_APP_SETTINGS,
          defaultSandbox: "danger-full-access",
        },
      ]),
    );
  });

  it("启用完全访问前要求明确确认", async () => {
    const runtime = new UiRuntime();
    const user = userEvent.setup();
    renderApp(runtime);
    await waitFor(() => expect(screen.getAllByText("Runtime 已连接").length).toBeGreaterThan(0));

    await user.click(screen.getByLabelText("权限模式"));
    await user.click(screen.getByRole("option", { name: /完全访问/ }));
    expect(screen.getByRole("dialog", { name: "启用完全访问？" })).toBeTruthy();
    expect(screen.getByLabelText("权限模式").textContent).toContain("工作区写入");

    await user.click(screen.getByRole("button", { name: "确认启用完全访问" }));
    expect(screen.getByLabelText("权限模式").textContent).toContain("完全访问");
    expect(screen.getByText("完全访问", { selector: ".danger-pill" })).toBeTruthy();
  });

  it("将 Runtime 原始错误展示为可操作的分类提示", async () => {
    const runtime = new UiRuntime();
    renderApp(runtime);
    await waitFor(() => expect(screen.getAllByText("Runtime 已连接").length).toBeGreaterThan(0));

    runtime.emitNotification({
      method: "error",
      params: { error: { message: "401 unauthorized API key" } },
    });

    expect((await screen.findAllByText("MiMo 认证失败")).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/打开设置验证 API Key/).length).toBeGreaterThanOrEqual(1);
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
        settingsService={new FakeSettingsService()}
        threadService={new FakeThreadService([])}
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
        settingsService={new FakeSettingsService()}
        threadService={new FakeThreadService([])}
      />,
    );
    await waitFor(() => expect(screen.getAllByText("Runtime 已连接").length).toBeGreaterThan(0));

    await user.click(screen.getByRole("button", { name: /second/ }));
    await user.type(screen.getByLabelText("任务内容"), "检查第二个项目");
    await user.click(screen.getByRole("button", { name: /开始任务/ }));

    await waitFor(() => expect(runtime.threadStarts.at(-1)?.cwd).toBe("D:\\projects\\second"));
  });

  it("切换项目时保持项目列表顺序不变", async () => {
    const projects = [fixtureProject(), secondProject()];
    const user = userEvent.setup();
    render(
      <DesktopRoot
        credentialService={new FakeCredentialService(true)}
        createSession={() => new DesktopSessionController(new UiRuntime())}
        projectService={new FakeProjectService(projects)}
        settingsService={new FakeSettingsService()}
        threadService={new FakeThreadService([])}
      />,
    );

    await waitFor(() => expect(screen.getAllByText("Runtime 已连接").length).toBeGreaterThan(0));
    expect(projectRowTitles()).toEqual(["D:\\projects\\fixture", "D:\\projects\\second"]);

    await user.click(screen.getByTitle("D:\\projects\\second"));
    await waitFor(() => expect(screen.getByRole("heading", { name: "second", level: 1 })).toBeTruthy());

    expect(projectRowTitles()).toEqual(["D:\\projects\\fixture", "D:\\projects\\second"]);
  });

  it("切换项目无需等待后端持久化即可更新界面", async () => {
    const projectService = new FakeProjectService([fixtureProject(), secondProject()]);
    const selectBarrier = deferred<void>();
    projectService.selectBarrier = selectBarrier.promise;
    const user = userEvent.setup();
    render(
      <DesktopRoot
        credentialService={new FakeCredentialService(true)}
        createSession={() => new DesktopSessionController(new UiRuntime())}
        projectService={projectService}
        settingsService={new FakeSettingsService()}
        threadService={new FakeThreadService([])}
      />,
    );

    await waitFor(() => expect(screen.getAllByText("Runtime 已连接").length).toBeGreaterThan(0));
    await user.click(screen.getByTitle("D:\\projects\\second"));

    expect(screen.getByRole("heading", { name: "second", level: 1 })).toBeTruthy();
    selectBarrier.resolve();
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

  it("右侧只展示 Git 暂存区中的文件变更摘要", async () => {
    const runtime = new UiRuntime();
    const project = {
      ...fixtureProject(),
      git: {
        ...fixtureProject().git,
        dirty: true,
        changedFiles: 1,
        stagedFiles: 1,
        additions: 2,
        diff: "## 已暂存\n\ndiff --git a/.gitignore b/.gitignore\n+node_modules/\n+dist/",
      },
    };
    renderApp(runtime, [project], project);

    expect(await screen.findByText("1 个文件 · 1 已暂存")).toBeTruthy();
    expect(screen.getAllByText("+2 -0")).toHaveLength(2);
    expect(screen.getByText(".gitignore")).toBeTruthy();
    expect(screen.queryByText(/diff --git a\/\.gitignore b\/\.gitignore/)).toBeNull();
  });

  it("右侧多文件变更只展示各文件修改数量", async () => {
    const runtime = new UiRuntime();
    const project = {
      ...fixtureProject(),
      git: {
        ...fixtureProject().git,
        dirty: true,
        changedFiles: 2,
        stagedFiles: 1,
        unstagedFiles: 1,
        additions: 2,
        deletions: 1,
        diff: `## 已暂存

diff --git a/.gitignore b/.gitignore
+++ b/.gitignore
+dist/

## 未暂存

diff --git a/src/app.ts b/src/app.ts
--- a/src/app.ts
+++ b/src/app.ts
-old
+next`,
      },
    };
    renderApp(runtime, [project], project);

    expect(await screen.findByText(".gitignore")).toBeTruthy();
    expect(screen.getByText("src/app.ts")).toBeTruthy();
    expect(screen.getByText("+1 -0")).toBeTruthy();
    expect(screen.getByText("+1 -1")).toBeTruthy();
    expect(screen.queryByText("-old")).toBeNull();
    expect(document.querySelector(".diff-file-detail")).toBeNull();
  });

  it("展示 Runtime 上报的 Token 用量", async () => {
    const runtime = new UiRuntime();
    renderApp(runtime);
    await waitFor(() => expect(screen.getAllByText("Runtime 已连接").length).toBeGreaterThan(0));

    runtime.emitNotification({
      method: "thread/tokenUsage/updated",
      params: {
        tokenUsage: {
          total: {
            inputTokens: 800,
            cachedInputTokens: 200,
            outputTokens: 224,
            reasoningOutputTokens: 24,
            totalTokens: 1024,
          },
          modelContextWindow: 131072,
        },
      },
    });

    expect(await screen.findByText("1,024")).toBeTruthy();
    expect(screen.getByText("131,072")).toBeTruthy();
  });

  it("任务完成后自动静默刷新 Git 状态", async () => {
    const projects = new FakeProjectService();
    const runtime = new UiRuntime();
    render(
      <DesktopRoot
        credentialService={new FakeCredentialService(true)}
        createSession={() => new DesktopSessionController(runtime)}
        projectService={projects}
        settingsService={new FakeSettingsService()}
        threadService={new FakeThreadService()}
      />,
    );
    await waitFor(() => expect(screen.getAllByText("Runtime 已连接").length).toBeGreaterThan(0));

    runtime.emitNotification({
      method: "turn/started",
      params: { turn: { id: "turn-refresh", status: "inProgress" } },
    });
    runtime.emitNotification({
      method: "turn/completed",
      params: { turn: { id: "turn-refresh", status: "completed" } },
    });

    await waitFor(() => expect(projects.refreshCount).toBeGreaterThan(0));
  });

  it("从真实最近线程列表恢复 Runtime 线程与本地投影", async () => {
    const runtime = new UiRuntime();
    const thread = fixtureThread();
    const user = userEvent.setup();
    render(
      <DesktopRoot
        credentialService={new FakeCredentialService(true)}
        createSession={() => new DesktopSessionController(runtime)}
        projectService={new FakeProjectService()}
        settingsService={new FakeSettingsService()}
        threadService={new FakeThreadService([thread])}
      />,
    );

    await waitFor(() => expect(screen.getAllByText("Runtime 已连接").length).toBeGreaterThan(0));
    await user.click(screen.getByTitle("修复历史测试"));

    await waitFor(() =>
      expect(runtime.threadResumes).toEqual([
        expect.objectContaining({
          threadId: "thread-history",
          model: "mimo-v2.5",
          modelProvider: "mimo",
          cwd: "D:\\projects\\fixture",
          approvalPolicy: "on-request",
          sandbox: "workspace-write",
          baseInstructions: expect.stringContaining("You are MiMo"),
        }),
      ]),
    );
    expect(await screen.findByText("已恢复的历史回复")).toBeTruthy();
    expect(screen.getByText("已处理 3m 12s")).toBeTruthy();
    expect(document.querySelector(".user-message")?.textContent).toContain("修复历史测试");
    expect(document.querySelector(".assistant-message")?.textContent).toContain("已恢复的历史回复");
    expect(document.querySelector(".entry-label")).toBeNull();
  });

  it("恢复历史线程后读取持久化活动记录", async () => {
    const runtime = new UiRuntime();
    const threads = new FakeThreadService([fixtureThread()], [fixtureActivityEvent()]);
    const user = userEvent.setup();
    render(
      <DesktopRoot
        credentialService={new FakeCredentialService(true)}
        createSession={() => new DesktopSessionController(runtime)}
        projectService={new FakeProjectService()}
        settingsService={new FakeSettingsService()}
        threadService={threads}
      />,
    );

    await user.click(await screen.findByTitle("修复历史测试"));
    await user.click(screen.getByRole("button", { name: "活动" }));

    expect(await screen.findByText("item/commandExecution/requestApproval")).toBeTruthy();
    expect(screen.getByText("已记录最近 1 条线程协议事件。")).toBeTruthy();
  });

  it("切换线程后只展示当前线程的活动记录", async () => {
    const runtime = new UiRuntime();
    const secondThread = {
      ...fixtureThread(),
      id: "thread-second",
      title: "第二个历史线程",
      timeline: fixtureThread().timeline.map((entry) =>
        entry.kind === "user" ? { ...entry, content: "第二个历史线程" } : entry,
      ),
      updatedAt: 3,
    };
    const secondActivity = {
      ...fixtureActivityEvent(),
      eventId: "activity-second-1",
      threadId: secondThread.id,
      protocol: {
        ...fixtureActivityEvent().protocol,
        threadId: secondThread.id,
        method: "turn/completed",
      },
    };
    const threads = new FakeThreadService(
      [fixtureThread(), secondThread],
      [fixtureActivityEvent(), secondActivity],
    );
    const user = userEvent.setup();
    render(
      <DesktopRoot
        credentialService={new FakeCredentialService(true)}
        createSession={() => new DesktopSessionController(runtime)}
        projectService={new FakeProjectService()}
        settingsService={new FakeSettingsService()}
        threadService={threads}
      />,
    );

    await user.click(await screen.findByTitle("修复历史测试"));
    await user.click(screen.getByRole("button", { name: "活动" }));
    expect(await screen.findByText("item/commandExecution/requestApproval")).toBeTruthy();

    await user.click(screen.getByTitle("第二个历史线程"));
    expect(await screen.findByText("turn/completed")).toBeTruthy();
    expect(screen.queryByText("item/commandExecution/requestApproval")).toBeNull();
  });

  it("切换线程时保持线程列表顺序不变", async () => {
    const secondThread = {
      ...fixtureThread(),
      id: "thread-second",
      title: "第二个历史线程",
      timeline: fixtureThread().timeline.map((entry) =>
        entry.kind === "user" ? { ...entry, content: "第二个历史线程" } : entry,
      ),
      updatedAt: 3,
    };
    const user = userEvent.setup();
    render(
      <DesktopRoot
        credentialService={new FakeCredentialService(true)}
        createSession={() => new DesktopSessionController(new UiRuntime())}
        projectService={new FakeProjectService()}
        settingsService={new FakeSettingsService()}
        threadService={new FakeThreadService([fixtureThread(), secondThread])}
      />,
    );

    await waitFor(() => expect(screen.getAllByText("Runtime 已连接").length).toBeGreaterThan(0));
    expect(threadRowTitles()).toEqual(["修复历史测试", "第二个历史线程"]);

    await user.click(screen.getByTitle("第二个历史线程"));
    await waitFor(() => expect(document.querySelector(".thread-row.active")?.getAttribute("title")).toBe("第二个历史线程"));

    expect(threadRowTitles()).toEqual(["修复历史测试", "第二个历史线程"]);
  });

  it("恢复线程无需等待 Runtime 响应即可展示本地投影", async () => {
    const runtime = new UiRuntime();
    const resumeBarrier = deferred<void>();
    runtime.resumeBarrier = resumeBarrier.promise;
    const user = userEvent.setup();
    render(
      <DesktopRoot
        credentialService={new FakeCredentialService(true)}
        createSession={() => new DesktopSessionController(runtime)}
        projectService={new FakeProjectService()}
        settingsService={new FakeSettingsService()}
        threadService={new FakeThreadService([fixtureThread()])}
      />,
    );

    await waitFor(() => expect(screen.getAllByText("Runtime 已连接").length).toBeGreaterThan(0));
    await user.click(screen.getByTitle("修复历史测试"));

    expect(document.querySelector(".thread-row.active")?.getAttribute("title")).toBe("修复历史测试");
    expect(screen.getByText("已恢复的历史回复")).toBeTruthy();
    resumeBarrier.resolve();
  });

  it("可以归档、恢复并移除本地线程索引", async () => {
    const runtime = new UiRuntime();
    const threads = new FakeThreadService([fixtureThread()]);
    const user = userEvent.setup();
    render(
      <DesktopRoot
        credentialService={new FakeCredentialService(true)}
        createSession={() => new DesktopSessionController(runtime)}
        projectService={new FakeProjectService()}
        settingsService={new FakeSettingsService()}
        threadService={threads}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "归档线程 修复历史测试" }));
    expect(await screen.findByText("已归档线程 · 1")).toBeTruthy();

    await user.click(screen.getByText("已归档线程 · 1"));
    await user.click(screen.getByRole("button", { name: "恢复线程 修复历史测试" }));
    expect(await screen.findByRole("button", { name: "归档线程 修复历史测试" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "归档线程 修复历史测试" }));
    await user.click(screen.getByText("已归档线程 · 1"));
    await user.click(screen.getByRole("button", { name: "移除本地线程索引 修复历史测试" }));
    expect(screen.getByRole("dialog", { name: "移除本地线程索引？" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "移除本地索引" }));

    await waitFor(() => expect(threads.deletedIds).toEqual(["thread-history"]));
  });

  it("将 Runtime 原始协议事件批量写入线程服务并实时展示活动", async () => {
    const runtime = new UiRuntime();
    const threads = new FakeThreadService();
    const user = userEvent.setup();
    render(
      <DesktopRoot
        credentialService={new FakeCredentialService(true)}
        createSession={() => new DesktopSessionController(runtime)}
        projectService={new FakeProjectService()}
        settingsService={new FakeSettingsService()}
        threadService={threads}
      />,
    );

    await waitFor(() => expect(screen.getAllByText("Runtime 已连接").length).toBeGreaterThan(0));
    await user.type(screen.getByLabelText("任务内容"), "检查活动记录");
    await user.click(screen.getByRole("button", { name: /开始任务/ }));
    await waitFor(() => expect(runtime.turnStarts).toHaveLength(1));
    runtime.emitProtocolEvent({
      sequence: 1,
      direction: "runtimeToClient",
      kind: "notification",
      method: "turn/started",
      requestId: null,
      threadId: "thread-1",
      message: {
        method: "turn/started",
        params: { threadId: "thread-1", turn: { id: "turn-raw", status: "inProgress" } },
      },
    });

    await waitFor(() => expect(threads.runtimeEvents).toHaveLength(1));
    expect(threads.runtimeEvents[0]?.threadId).toBe("thread-1");
    await user.click(screen.getByRole("button", { name: "活动" }));
    expect(await screen.findByText("turn/started")).toBeTruthy();
  });
});

function renderApp(
  runtime: UiRuntime,
  projects: ProjectSummary[] = [fixtureProject()],
  currentProject: ProjectSummary | null = projects[0] ?? null,
) {
  return render(
    <App
      activityError={null}
      activityEvents={[]}
      archivedThreads={[]}
      currentProject={currentProject}
      onAddProject={() => undefined}
      onDeleteThread={() => undefined}
      onNewThread={() => undefined}
      onRefreshProject={() => undefined}
      onSelectProject={() => undefined}
      onSelectThread={() => undefined}
      onSetThreadArchived={() => undefined}
      projectBusy={false}
      projectError={null}
      projects={projects}
      session={new DesktopSessionController(runtime)}
      settings={DEFAULT_APP_SETTINGS}
      threadBusy={false}
      threadError={null}
      threads={[]}
    />,
  );
}

class UiRuntime implements RuntimeClientPort {
  initializeCount = 0;
  resumeBarrier: Promise<void> | null = null;
  readonly threadStarts: ThreadStartParams[] = [];
  readonly threadResumes: ThreadResumeParams[] = [];
  readonly turnStarts: TurnStartParams[] = [];
  readonly responses: Array<{ id: RequestId; result: JsonValue | undefined }> = [];
  readonly #notifications = new Set<(notification: ServerNotification) => void>();
  readonly #protocolEvents = new Set<(event: RuntimeProtocolEvent) => void>();
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

  async resumeThread(params: ThreadResumeParams): Promise<ThreadResumeResponse> {
    this.threadResumes.push(params);
    await this.resumeBarrier;
    return {
      thread: { id: params.threadId },
      model: "mimo-v2.5",
      modelProvider: "mimo",
      cwd: "D:\\projects\\fixture",
    };
  }

  async archiveThread(_params: ThreadArchiveParams): Promise<ThreadArchiveResponse> {
    return {};
  }

  async unarchiveThread(_params: ThreadUnarchiveParams): Promise<ThreadUnarchiveResponse> {
    return {};
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

  onProtocolEvent(listener: (event: RuntimeProtocolEvent) => void): () => void {
    this.#protocolEvents.add(listener);
    return () => this.#protocolEvents.delete(listener);
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

  emitNotification(notification: ServerNotification): void {
    for (const listener of this.#notifications) {
      listener(notification);
    }
  }

  emitProtocolEvent(event: RuntimeProtocolEvent): void {
    for (const listener of this.#protocolEvents) {
      listener(event);
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

class FakeSettingsService implements SettingsService {
  readonly diagnosed: ConnectionDiagnosticInput[] = [];
  readonly saved: AppSettings[] = [];
  diagnosticResult: ConnectionDiagnostic = {
    ok: true,
    category: "success",
    message: "连接成功",
    detail: "测试连接成功。",
    latencyMs: 42,
    statusCode: 200,
  };
  #settings: AppSettings;

  constructor(settings: AppSettings = DEFAULT_APP_SETTINGS) {
    this.#settings = settings;
  }

  async get(): Promise<AppSettings> {
    return this.#settings;
  }

  async save(settings: AppSettings): Promise<AppSettings> {
    const normalized = normalizeSettings(settings);
    this.saved.push(normalized);
    this.#settings = normalized;
    return normalized;
  }

  async diagnose(input: ConnectionDiagnosticInput): Promise<ConnectionDiagnostic> {
    this.diagnosed.push(input);
    return this.diagnosticResult;
  }
}

class FakeProjectService implements ProjectService {
  refreshCount = 0;
  selectBarrier: Promise<void> | null = null;
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
    await this.selectBarrier;
    const selected = this.#state.projects.find((project) => project.id === projectId);
    this.#state = {
      projects: selected
        ? [selected, ...this.#state.projects.filter((project) => project.id !== projectId)]
        : this.#state.projects,
      selectedProjectId: projectId,
    };
    return this.#state;
  }

  async refresh(_projectId: string): Promise<ProjectState> {
    this.refreshCount += 1;
    return this.#state;
  }
}

class FakeThreadService implements ThreadService {
  readonly deletedIds: string[] = [];
  readonly runtimeEvents: SessionRuntimeEvent[] = [];
  readonly activityEvents: ThreadActivityEvent[];
  #state: ThreadState;

  constructor(threads: ThreadRecord[] = [], activityEvents: ThreadActivityEvent[] = []) {
    this.#state = { threads, selectedThreadId: null };
    this.activityEvents = activityEvents;
  }

  async list(): Promise<ThreadState> {
    return this.#state;
  }

  async listActivity(threadId: string): Promise<ThreadActivityEvent[]> {
    return [
      ...this.activityEvents.filter((event) => event.threadId === threadId),
      ...this.runtimeEvents
        .filter((event) => event.threadId === threadId)
        .map((event, index) => ({ ...event, occurredAt: index + 1 })),
    ];
  }

  async upsert(thread: ThreadRecord): Promise<ThreadState> {
    this.#state = {
      threads: [thread, ...this.#state.threads.filter((candidate) => candidate.id !== thread.id)],
      selectedThreadId: thread.id,
    };
    return this.#state;
  }

  async select(threadId: string | null): Promise<ThreadState> {
    const selected = this.#state.threads.find((thread) => thread.id === threadId);
    this.#state = {
      threads: selected
        ? [selected, ...this.#state.threads.filter((thread) => thread.id !== threadId)]
        : this.#state.threads,
      selectedThreadId: threadId,
    };
    return this.#state;
  }

  async setArchived(threadId: string, archived: boolean): Promise<ThreadState> {
    this.#state = {
      ...this.#state,
      threads: this.#state.threads.map((thread) =>
        thread.id === threadId ? { ...thread, archived } : thread,
      ),
    };
    return this.#state;
  }

  async delete(threadId: string): Promise<ThreadState> {
    this.deletedIds.push(threadId);
    this.#state = {
      ...this.#state,
      threads: this.#state.threads.filter((thread) => thread.id !== threadId),
    };
    return this.#state;
  }

  async appendRuntimeEvents(events: SessionRuntimeEvent[]): Promise<void> {
    this.runtimeEvents.push(...events);
  }
}

function projectRowTitles(): string[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>(".project-row")).map(
    (project) => project.title,
  );
}

function threadRowTitles(): string[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>(".thread-row")).map(
    (thread) => thread.title,
  );
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
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
      stagedFiles: 0,
      unstagedFiles: 0,
      additions: 0,
      deletions: 0,
      diff: "",
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
    git: {
      ...fixtureProject().git,
      branch: "feature/project-management",
      dirty: true,
      changedFiles: 2,
      unstagedFiles: 2,
      additions: 3,
      deletions: 1,
      diff: "## 未暂存\n\n+ updated",
    },
    lastOpenedAt: 1,
  };
}

function fixtureThread(): ThreadRecord {
  return {
    id: "thread-history",
    projectId: fixtureProject().id,
    projectPath: fixtureProject().path,
    title: "修复历史测试",
    model: "mimo-v2.5",
    sandbox: "workspace-write",
    turnStatus: "completed",
    timeline: [
      {
        id: "history-user",
        kind: "user",
        title: "你",
        content: "修复历史测试",
        status: null,
        startedAt: 1_000,
        completedAt: 193_000,
      },
      {
        id: "history-assistant",
        kind: "assistant",
        title: "MiMo",
        content: "已恢复的历史回复",
        status: "completed",
        startedAt: 2_000,
        completedAt: 193_000,
      },
    ],
    diff: "",
    createdAt: 1,
    updatedAt: 2,
    archived: false,
  };
}

function fixtureActivityEvent(): ThreadActivityEvent {
  return {
    eventId: "activity-history-1",
    threadId: "thread-history",
    occurredAt: 1,
    protocol: {
      sequence: 1,
      direction: "runtimeToClient",
      kind: "request",
      method: "item/commandExecution/requestApproval",
      requestId: "approval-history",
      threadId: "thread-history",
      message: {
        id: "approval-history",
        method: "item/commandExecution/requestApproval",
        params: { command: "npm test", reason: "运行验证" },
      },
    },
  };
}
