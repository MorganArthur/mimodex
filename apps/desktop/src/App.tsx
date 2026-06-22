import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import {
  type ApprovalDecision,
  type DesktopSessionController,
  type PendingApproval,
  type SessionState,
  type TimelineEntry,
} from "@mimodex/desktop-core";
import { ConfirmationDialog } from "./ConfirmationDialog.js";
import { parseUnifiedDiff, type DiffFile } from "./diff.js";
import { MarkdownContent } from "./MarkdownContent.js";
import { MIMO_MODEL_OPTIONS, PopupSelect, SANDBOX_OPTIONS } from "./PopupSelect.js";
import type { ProjectSummary } from "./projects.js";
import type { AppSettings } from "./settings.js";
import type { ThreadActivityEvent, ThreadRecord } from "./threads.js";
import { APP_VERSION } from "./version.js";

export type AppProps = {
  activityError: string | null;
  activityEvents: ThreadActivityEvent[];
  archivedThreads: ThreadRecord[];
  currentProject: ProjectSummary | null;
  onAddProject: () => void | Promise<void>;
  onDeleteThread: (threadId: string) => void | Promise<void>;
  onNewThread: () => void | Promise<void>;
  onOpenSettings?: () => void;
  onRefreshProject: () => void | Promise<void>;
  onSelectProject: (projectId: string) => void | Promise<void>;
  onSelectThread: (threadId: string) => void | Promise<void>;
  onSetThreadArchived: (threadId: string, archived: boolean) => void | Promise<void>;
  projectBusy: boolean;
  projectError: string | null;
  projects: ProjectSummary[];
  session: DesktopSessionController;
  settings: AppSettings;
  threadBusy: boolean;
  threadError: string | null;
  threads: ThreadRecord[];
};

const statusLabels: Record<SessionState["connection"], string> = {
  idle: "尚未连接",
  connecting: "正在连接",
  ready: "Runtime 已连接",
  error: "连接异常",
};

export function App({
  activityError,
  activityEvents,
  archivedThreads,
  currentProject,
  onAddProject,
  onDeleteThread,
  onNewThread,
  onOpenSettings = () => undefined,
  onRefreshProject,
  onSelectProject,
  onSelectThread,
  onSetThreadArchived,
  projectBusy,
  projectError,
  projects,
  session,
  settings,
  threadBusy,
  threadError,
  threads,
}: AppProps) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [model, setModel] = useState<"mimo-v2.5" | "mimo-v2.5-pro">(settings.defaultModel);
  const [sandbox, setSandbox] = useState<"danger-full-access" | "read-only" | "workspace-write">(
    settings.defaultSandbox,
  );
  const [deleteThreadTarget, setDeleteThreadTarget] = useState<ThreadRecord | null>(null);
  const [fullAccessWarningOpen, setFullAccessWarningOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [environmentPanel, setEnvironmentPanel] = useState<"changes" | "progress">("changes");
  const [environmentOpen, setEnvironmentOpen] = useState(false);
  const conversationRef = useRef<HTMLElement>(null);
  const submittingRef = useRef(false);
  const gitDiff = currentProject?.git.diff ?? "";
  const visibleDiff = currentProject?.git.dirty ? gitDiff : state.diff;
  const parsedDiffFiles = useMemo(() => parseUnifiedDiff(visibleDiff), [visibleDiff]);
  const diffFiles = currentProject?.git.dirty
    ? currentProject.git.changedFiles + currentProject.git.untrackedFiles
    : state.diff
      ? 1
      : 0;
  const diffCount = currentProject?.git.dirty
    ? `+${currentProject.git.additions} -${currentProject.git.deletions}`
    : state.diff
      ? "+1 -1"
      : "0";
  const hasConversationContent =
    state.timeline.length > 0 || state.approvals.length > 0 || Boolean(state.structuredError);

  useEffect(() => {
    void session.connect().catch(() => undefined);
  }, [session]);

  useEffect(() => {
    if (state.threadId) {
      setModel(state.model === "mimo-v2.5-pro" ? "mimo-v2.5-pro" : "mimo-v2.5");
      setSandbox(state.sandbox);
    } else {
      setModel(settings.defaultModel);
      setSandbox(settings.defaultSandbox);
    }
  }, [
    settings.defaultModel,
    settings.defaultSandbox,
    state.model,
    state.sandbox,
    state.threadId,
  ]);

  useEffect(() => {
    if (state.turnStatus !== "inProgress") {
      return;
    }
    const conversation = conversationRef.current;
    if (conversation) {
      conversation.scrollTop = conversation.scrollHeight;
    }
  }, [state.timeline, state.approvals, state.turnStatus]);

  const canSubmit =
    Boolean(message.trim()) &&
    Boolean(currentProject?.available) &&
    state.connection === "ready" &&
    state.turnStatus !== "inProgress" &&
    !submitting;

  const submitTask = async () => {
    if (!canSubmit || !currentProject || submittingRef.current) {
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    try {
      await session.startTask({ text: message, projectPath: currentProject.path, model, sandbox });
      setMessage("");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void submitTask();
  };

  const submitOnEnter = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }
    event.preventDefault();
    void submitTask();
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <nav className="primary-nav" aria-label="主导航">
          <button
            aria-label="新建线程"
            className="nav-command"
            disabled={!currentProject?.available || projectBusy || threadBusy}
            type="button"
            onClick={() => void onNewThread()}
          >
            <span aria-hidden="true">+</span>
            新对话
          </button>
        </nav>

        <div className="sidebar-section projects">
          <div className="section-heading">
            <span>项目</span>
            <button
              aria-label="添加项目"
              disabled={projectBusy}
              type="button"
              onClick={() => void onAddProject()}
            >
              +
            </button>
          </div>
          {projects.length === 0 ? (
            <button
              className="empty-projects"
              disabled={projectBusy}
              type="button"
              onClick={() => void onAddProject()}
            >
              添加本地项目文件夹
            </button>
          ) : (
            projects.map((project) => {
              const activeProject = project.id === currentProject?.id;
              return (
                <div className={`project-group ${activeProject ? "active" : ""}`} key={project.id}>
                  <button
                    className={`project-row ${activeProject ? "active" : ""}`}
                    disabled={projectBusy}
                    title={project.path}
                    type="button"
                    onClick={() => void onSelectProject(project.id)}
                  >
                    <span className="project-icon" aria-hidden="true">▱</span>
                    <span className="project-copy">
                      <strong>{project.name}</strong>
                      {project.git.dirty && <i>{project.git.changedFiles + project.git.untrackedFiles}</i>}
                    </span>
                  </button>
                  {activeProject && (
                    <div className="project-thread-list">
                      {threads.length === 0 ? (
                        <p className="empty-threads">这个项目还没有线程。</p>
                      ) : (
                        threads.map((thread) => (
                          <ThreadRow
                            active={thread.id === state.threadId}
                            disabled={projectBusy || threadBusy || !currentProject?.available}
                            key={thread.id}
                            onArchive={() => void onSetThreadArchived(thread.id, true)}
                            onSelect={() => void onSelectThread(thread.id)}
                            thread={thread}
                          />
                        ))
                      )}
                      {archivedThreads.length > 0 && (
                        <details className="archived-threads">
                          <summary>已归档线程 · {archivedThreads.length}</summary>
                          {archivedThreads.map((thread) => (
                            <ThreadRow
                              archived
                              disabled={threadBusy}
                              key={thread.id}
                              onDelete={() => setDeleteThreadTarget(thread)}
                              onRestore={() => void onSetThreadArchived(thread.id, false)}
                              thread={thread}
                            />
                          ))}
                        </details>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
          {projectError && <p className="sidebar-error">{projectError}</p>}
          {threadError && <p className="sidebar-error">{threadError}</p>}
        </div>

        <div className="sidebar-spacer" />

        <div className="sidebar-footer">
          <button type="button" aria-label="打开设置" onClick={onOpenSettings}>
            <span aria-hidden="true">⚙</span>
            设置
          </button>
          <span className="app-version">当前版本 v{APP_VERSION}</span>
        </div>
      </aside>

      <main className={`workspace ${hasConversationContent ? "has-thread" : "empty-thread"}`}>
        <section className="codex-window">
          <header className="topbar">
            <div className="topbar-title-group">
              <p className="eyebrow">{currentProject ? projectBreadcrumb(currentProject) : "尚未选择项目"}</p>
              <h1>{currentProject?.name ?? "添加一个本地项目"}</h1>
            </div>
            <div className="topbar-actions">
              {currentProject && (
                <button
                  aria-label="刷新 Git"
                  className="refresh-project"
                  disabled={projectBusy}
                  title={currentProject.path}
                  type="button"
                  onClick={() => void onRefreshProject()}
                >
                  <span aria-hidden="true">↻</span>
                  {projectBusy ? "刷新中" : "刷新 Git"}
                </button>
              )}
              <span className="model-pill">{model}</span>
              {sandbox === "danger-full-access" && <span className="danger-pill">完全访问</span>}
              <span className={`run-status ${state.turnStatus}`}>
                {state.turnStatus === "inProgress" ? "执行中" : "就绪"}
              </span>
              <span className="runtime-status-compat">{statusLabels[state.connection]}</span>
              {state.turnStatus === "inProgress" && (
                <button className="stop-button" type="button" onClick={() => void session.stop()}>
                  停止
                </button>
              )}
              <EnvironmentPopover
                contextPanel={environmentPanel}
                currentProject={currentProject}
                diffCount={diffCount}
                diffFiles={diffFiles}
                files={parsedDiffFiles}
                open={environmentOpen}
                state={state}
                onOpenChange={setEnvironmentOpen}
                onPanelChange={setEnvironmentPanel}
              />
            </div>
          </header>

          <div className="workspace-stage">
            <section className="conversation" ref={conversationRef}>
              {!currentProject ? (
                <ProjectWelcome onAdd={() => void onAddProject()} />
              ) : !currentProject.available ? (
                <UnavailableProject project={currentProject} onAdd={() => void onAddProject()} />
              ) : state.timeline.length === 0 ? (
                <WelcomePanel onSelect={setMessage} project={currentProject} />
              ) : (
                <Timeline entries={state.timeline} turnStatus={state.turnStatus} />
              )}
              {state.approvals.map((approval) => (
                <ApprovalCard
                  approval={approval}
                  key={String(approval.id)}
                  onDecision={(decision) => void session.resolveApproval(approval.id, decision)}
                />
              ))}
              {state.structuredError && <RuntimeErrorCard error={state.structuredError} />}
            </section>

            <form className="composer" onSubmit={(event) => void submit(event)}>
              <textarea
                aria-label="任务内容"
                enterKeyHint="send"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                onKeyDown={submitOnEnter}
                placeholder="描述你希望 Mimodex 在当前项目中完成的任务"
                rows={3}
              />
              <div className="composer-toolbar">
                <button
                  aria-label="添加上下文"
                  className="composer-icon-button"
                  disabled={!currentProject?.available}
                  type="button"
                >
                  +
                </button>
                <PopupSelect
                  ariaLabel="权限模式"
                  className="composer-popup-select sandbox-popup-select"
                  label="权限"
                  options={SANDBOX_OPTIONS}
                  placement="top"
                  value={sandbox}
                  onChange={(next) => {
                    if (next === "danger-full-access" && sandbox !== "danger-full-access") {
                      setFullAccessWarningOpen(true);
                    } else {
                      setSandbox(next as typeof sandbox);
                    }
                  }}
                />
                <div className="composer-spacer" />
                <ContextWindowControl state={state} />
                <ModelPicker model={model} onChange={setModel} />
                <button
                  aria-label="开始任务"
                  className="send-button"
                  type="submit"
                  disabled={!canSubmit}
                >
                  {submitting ? <span aria-hidden="true" className="send-loading" /> : <SendArrowIcon />}
                </button>
              </div>
              <div className="composer-meta">
                <ProjectPicker
                  currentProject={currentProject}
                  disabled={projectBusy}
                  projects={projects}
                  onSelectProject={onSelectProject}
                />
                <span className="meta-chip">本地模式</span>
                <span className="meta-chip">
                  {currentProject?.git.branch ?? currentProject?.git.head ?? "无 Git 分支"}
                </span>
              </div>
            </form>
          </div>
        </section>
      </main>
      {fullAccessWarningOpen && (
        <ConfirmationDialog
          cancelLabel="保持工作区写入"
          confirmLabel="确认启用完全访问"
          description="Agent 将能够访问当前项目之外的文件并运行具有系统级副作用的命令。请只在明确需要时启用，并仔细审阅每项操作。"
          eyebrow="高风险权限"
          onCancel={() => setFullAccessWarningOpen(false)}
          onConfirm={() => {
            setSandbox("danger-full-access");
            setFullAccessWarningOpen(false);
          }}
          title="启用完全访问？"
          tone="danger"
        />
      )}
      {deleteThreadTarget && (
        <ConfirmationDialog
          cancelLabel="保留索引"
          confirmLabel="移除本地索引"
          description={`将移除线程“${deleteThreadTarget.title}”的 Mimodex 本地索引，Runtime 归档历史仍会保留。`}
          eyebrow="线程管理"
          onCancel={() => setDeleteThreadTarget(null)}
          onConfirm={() => {
            void onDeleteThread(deleteThreadTarget.id);
            setDeleteThreadTarget(null);
          }}
          title="移除本地线程索引？"
          tone="danger"
        />
      )}
    </div>
  );
}

function ProjectWelcome({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="welcome-panel project-welcome">
      <span className="welcome-kicker">LOCAL PROJECT REQUIRED</span>
      <h2>先选择项目，<br />再把任务交给 MiMo。</h2>
      <p>项目记录只保存在 Mimodex 应用数据目录。选择文件夹后会读取 Git 分支和工作区状态。</p>
      <button className="add-project-primary" type="button" onClick={onAdd}>添加本地项目</button>
    </div>
  );
}

function UnavailableProject({
  onAdd,
  project,
}: {
  onAdd: () => void;
  project: ProjectSummary;
}) {
  return (
    <div className="welcome-panel project-welcome">
      <span className="welcome-kicker">PROJECT UNAVAILABLE</span>
      <h2>找不到 {project.name}。</h2>
      <p>原路径为 {project.path}。请恢复该文件夹，或添加一个新的本地项目后继续。</p>
      <button className="add-project-primary" type="button" onClick={onAdd}>
        添加其他项目
      </button>
    </div>
  );
}

function WelcomePanel({
  onSelect,
  project,
}: {
  onSelect: (message: string) => void;
  project: ProjectSummary;
}) {
  return (
    <div className="welcome-panel">
      <h2>我们应该在 {project.name} 中构建什么？</h2>
      <div className="suggestion-grid">
        <button type="button" onClick={() => onSelect("定位并修复当前项目中的失败测试。")}>
          <strong>修复失败测试</strong><span>定位根因并运行聚焦验证</span>
        </button>
        <button type="button" onClick={() => onSelect("审阅当前工作区改动，优先报告风险和缺失测试。")}>
          <strong>审阅当前改动</strong><span>检查风险与缺失测试</span>
        </button>
        <button type="button" onClick={() => onSelect("先检查项目结构，再实现一个范围清晰的小功能。")}>
          <strong>实现一个小功能</strong><span>先读项目，再提交最小修改</span>
        </button>
      </div>
    </div>
  );
}

function projectBreadcrumb(project: ProjectSummary): string {
  if (!project.git.isRepository) {
    return `${project.name} / LOCAL`;
  }
  return `${project.name} / ${project.git.branch ?? project.git.head ?? "DETACHED"}`;
}

function projectSummary(project: ProjectSummary): string {
  if (!project.available) {
    return "项目文件夹当前不可访问。";
  }
  if (!project.git.isRepository) {
    return "本地文件夹，尚未检测到 Git 仓库。";
  }
  const changes = project.git.changedFiles + project.git.untrackedFiles;
  return changes > 0
    ? `${project.git.branch ?? "Detached HEAD"}，工作区有 ${changes} 项变更。`
    : `${project.git.branch ?? "Detached HEAD"}，工作区干净。`;
}

function gitChangeSummary(project: ProjectSummary | null, files: number): string {
  if (!project?.git.dirty) {
    return `${files} 个文件`;
  }
  const parts = [`${files} 个文件`];
  if (project.git.stagedFiles > 0) {
    parts.push(`${project.git.stagedFiles} 已暂存`);
  }
  if (project.git.unstagedFiles > 0) {
    parts.push(`${project.git.unstagedFiles} 未暂存`);
  }
  if (project.git.untrackedFiles > 0) {
    parts.push(`${project.git.untrackedFiles} 未跟踪`);
  }
  return parts.join(" · ");
}

function threadStatusClass(status: ThreadRecord["turnStatus"]): string {
  return status === "inProgress" ? "running" : status;
}

function ThreadRow({
  active = false,
  archived = false,
  disabled,
  onArchive,
  onDelete,
  onRestore,
  onSelect,
  thread,
}: {
  active?: boolean;
  archived?: boolean;
  disabled: boolean;
  onArchive?: () => void;
  onDelete?: () => void;
  onRestore?: () => void;
  onSelect?: () => void;
  thread: ThreadRecord;
}) {
  return (
    <div className="thread-list-item">
      <button
        className={`thread-row ${active ? "active" : ""}`}
        disabled={disabled || archived}
        title={thread.title}
        type="button"
        onClick={onSelect}
      >
        <span className={`thread-state ${threadStatusClass(thread.turnStatus)}`} />
        <div>
          <strong>{thread.title}</strong>
          <span>{threadSubtitle(thread)}</span>
        </div>
        {thread.unread && <span aria-label="线程有未读更新" className="thread-unread" />}
        {thread.turnStatus === "inProgress" && <span aria-hidden="true" className="thread-progress"><i /></span>}
      </button>
      <div className="thread-actions">
        {archived ? (
          <>
            <button aria-label={`恢复线程 ${thread.title}`} disabled={disabled} type="button" onClick={onRestore}>
              恢复
            </button>
            <button
              aria-label={`移除本地线程索引 ${thread.title}`}
              className="delete-thread"
              disabled={disabled}
              type="button"
              onClick={onDelete}
            >
              移除
            </button>
          </>
        ) : (
          <button aria-label={`归档线程 ${thread.title}`} disabled={disabled} type="button" onClick={onArchive}>
            归档
          </button>
        )}
      </div>
    </div>
  );
}

function threadSubtitle(thread: ThreadRecord): string {
  const status =
    thread.turnStatus === "inProgress"
      ? "正在执行"
      : thread.turnStatus === "failed"
        ? "执行失败"
        : thread.turnStatus === "interrupted"
          ? "已中断"
          : thread.turnStatus === "completed"
            ? "已完成"
            : "待开始";
  return `${status} · ${relativeTime(thread.updatedAt)}`;
}

function relativeTime(timestamp: number): string {
  const elapsed = Math.max(0, Date.now() - timestamp);
  if (elapsed < 60_000) {
    return "刚刚";
  }
  if (elapsed < 3_600_000) {
    return `${Math.floor(elapsed / 60_000)} 分钟前`;
  }
  if (elapsed < 86_400_000) {
    return `${Math.floor(elapsed / 3_600_000)} 小时前`;
  }
  return `${Math.floor(elapsed / 86_400_000)} 天前`;
}

function formatTokens(value: number | null | undefined): string {
  return value === null || value === undefined ? "等待统计" : value.toLocaleString("zh-CN");
}

function formatContextUsage(usage: NonNullable<SessionState["tokenUsage"]>): string {
  if (!usage.contextWindow || usage.contextWindow <= 0) {
    return `${formatTokens(usage.totalTokens)} / 未知容量`;
  }
  const ratio = usage.totalTokens / usage.contextWindow;
  const percent =
    ratio <= 0
      ? "0%"
      : ratio < 0.01
        ? "<1%"
        : `${Math.round(ratio * 100).toLocaleString("zh-CN")}%`;
  return `${formatTokens(usage.totalTokens)} / ${formatTokens(usage.contextWindow)} (${percent})`;
}

function contextCompactionLabel(compaction: SessionState["contextCompaction"]): string {
  if (!compaction.enabled) {
    return "未启用";
  }
  if (compaction.status === "pending") {
    return "下次提交前自动压缩";
  }
  if (compaction.status === "injected") {
    return "本轮已注入压缩";
  }
  if (compaction.status === "watching") {
    return "监测中";
  }
  return "等待统计";
}

function ContextWindowControl({ state }: { state: SessionState }) {
  const [open, setOpen] = useState(false);
  const usage = contextWindowCardSummary(state.tokenUsage);
  return (
    <div className={`context-window-control ${open ? "open" : ""}`}>
      <button
        aria-expanded={open}
        aria-label="背景信息窗口"
        className="context-window-trigger"
        title={usage.detail}
        type="button"
        onClick={() => setOpen(!open)}
      >
        <span aria-hidden="true" />
      </button>
      {open && (
        <div className="context-window-popover" role="dialog" aria-label="背景信息窗口详情">
          <span>背景信息窗口:</span>
          <strong>{usage.primary}</strong>
          <small>{usage.detail}</small>
          <dl>
            <div>
              <dt>Token 总量</dt>
              <dd>{formatTokens(state.tokenUsage?.totalTokens)}</dd>
            </div>
            <div>
              <dt>上下文占用</dt>
              <dd>{state.tokenUsage ? formatContextUsage(state.tokenUsage) : "等待统计"}</dd>
            </div>
            <div>
              <dt>自动压缩</dt>
              <dd>{contextCompactionLabel(state.contextCompaction)}</dd>
            </div>
          </dl>
        </div>
      )}
    </div>
  );
}

function contextWindowCardSummary(usage: SessionState["tokenUsage"]): {
  detail: string;
  primary: string;
} {
  if (!usage) {
    return { primary: "等待统计", detail: "提交任务后显示用量" };
  }
  if (!usage.contextWindow || usage.contextWindow <= 0) {
    return {
      primary: `${formatCompactTokens(usage.totalTokens)} 已用`,
      detail: "上下文容量未知",
    };
  }
  const percent = Math.min(100, Math.max(0, Math.round((usage.totalTokens / usage.contextWindow) * 100)));
  const remaining = Math.max(0, 100 - percent);
  return {
    primary: `${percent}% 已用（剩余 ${remaining}%）`,
    detail: `已用 ${formatCompactTokens(usage.totalTokens)} 标记，共 ${formatCompactTokens(usage.contextWindow)}`,
  };
}

function formatCompactTokens(value: number): string {
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    return `${Number.isInteger(millions) ? millions.toFixed(0) : millions.toFixed(1)}m`;
  }
  if (value >= 1_000) {
    return `${Math.round(value / 1_000)}k`;
  }
  return value.toLocaleString("zh-CN");
}

function EnvironmentPopover({
  contextPanel,
  currentProject,
  diffCount,
  diffFiles,
  files,
  open,
  state,
  onOpenChange,
  onPanelChange,
}: {
  contextPanel: "changes" | "progress";
  currentProject: ProjectSummary | null;
  diffCount: string;
  diffFiles: number;
  files: DiffFile[];
  open: boolean;
  state: SessionState;
  onOpenChange: (open: boolean) => void;
  onPanelChange: (panel: "changes" | "progress") => void;
}) {
  const branch = currentProject?.git.branch ?? currentProject?.git.head ?? "无 Git 分支";
  return (
    <div className={`environment-control ${open ? "open" : ""}`}>
      <button
        aria-expanded={open}
        aria-label="环境信息"
        className="environment-toggle"
        type="button"
        onClick={() => onOpenChange(!open)}
      >
        <span aria-hidden="true">☷</span>
      </button>
      {open && (
        <section aria-label="环境信息" className="environment-popover">
          <header>
            <span>环境信息</span>
            <button aria-label="环境设置" type="button">⚙</button>
          </header>
          {contextPanel === "changes" ? (
            <>
              <EnvironmentChangesView
                branch={branch}
                currentProject={currentProject}
                diffCount={diffCount}
                diffFiles={diffFiles}
                files={files}
                sandbox={state.sandbox}
                state={state}
                onOpenProgress={() => onPanelChange("progress")}
              />
              <div className="environment-divider" />
              <EnvironmentRow icon="◎" label="浏览器" value="Mimodex 127.0.0.1:1420" />
              <div className="environment-divider" />
              <div className="environment-source">
                <span>来源</span>
                <strong>暂无来源</strong>
              </div>
            </>
          ) : (
            <EnvironmentProgressView state={state} onBack={() => onPanelChange("changes")} />
          )}
        </section>
      )}
    </div>
  );
}

function EnvironmentChangesView({
  branch,
  currentProject,
  diffCount,
  diffFiles,
  files,
  onOpenProgress,
  sandbox,
  state,
}: {
  branch: string;
  currentProject: ProjectSummary | null;
  diffCount: string;
  diffFiles: number;
  files: DiffFile[];
  onOpenProgress: () => void;
  sandbox: SessionState["sandbox"];
  state: SessionState;
}) {
  return (
    <div className="environment-view">
      <EnvironmentRow
        accent
        icon="±"
        label="变更"
        value={diffCount}
      />
      <EnvironmentRow icon="▱" label="本地" value={sandboxLabel(sandbox)} />
      <EnvironmentRow icon="⌁" label="分支" value={branch} />
      <EnvironmentRow icon="↗" label="提交或推送" value={diffFiles > 0 ? "可审阅" : "等待变更"} />
      <EnvironmentRow icon="◌" label="GitHub CLI" value="不可用" muted />
      {diffFiles > 0 && (
        <>
          <div className="environment-divider" />
          <section className="environment-detail">
            <span>当前变更</span>
            <strong>{gitChangeSummary(currentProject, diffFiles)}</strong>
            {files.length > 0 && (
              <div className="environment-file-list">
                {files.map((file) => (
                  <div className="environment-file-row" key={file.id}>
                    <span title={file.path}>{file.path}</span>
                    <i>+{file.additions} -{file.deletions}</i>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
      <div className="environment-divider" />
      <button className="environment-progress-row" type="button" aria-label="进度" onClick={onOpenProgress}>
        <span>
          <i aria-hidden="true">◷</i>
          进度
        </span>
        <small>
          {progressSummary(state)}
          <strong aria-hidden="true">›</strong>
        </small>
      </button>
      {currentProject && <span className="environment-project-note">{projectSummary(currentProject)}</span>}
    </div>
  );
}

function EnvironmentProgressView({
  onBack,
  state,
}: {
  onBack: () => void;
  state: SessionState;
}) {
  const steps = taskProgressSteps(state);
  return (
    <div className="environment-view">
      <button className="environment-progress-row back" type="button" onClick={onBack}>
        <strong aria-hidden="true">‹</strong>
        <span>环境信息</span>
      </button>
      <div className="environment-divider" />
      <section className="environment-detail environment-progress-detail">
        <span>进度</span>
        <strong>{progressSummary(state)}</strong>
        <p>
          {state.turnStatus === "inProgress"
            ? "这里仅显示当前任务执行中的分步骤。"
            : "当前没有正在执行的任务。"}
        </p>
        {steps.length > 0 ? (
          <ol className="progress-step-list">
            {steps.map((step) => (
              <li className={step.statusClass} key={step.id}>
                <span aria-hidden="true" />
                <div>
                  <strong>{step.label}</strong>
                  {step.detail && <small>{step.detail}</small>}
                </div>
                <em>{step.status}</em>
              </li>
            ))}
          </ol>
        ) : (
          <div className="empty-progress">
            <span aria-hidden="true">◷</span>
            <strong>{state.turnStatus === "inProgress" ? "等待步骤" : "暂无进度"}</strong>
            <p>任务开始并产生工具、文件、审批或推理步骤后才会显示在这里。</p>
          </div>
        )}
      </section>
    </div>
  );
}

type TaskProgressStep = {
  detail: string;
  id: string;
  label: string;
  status: string;
  statusClass: string;
};

function progressSummary(state: SessionState): string {
  if (state.turnStatus !== "inProgress") {
    return "空闲";
  }
  const steps = taskProgressSteps(state);
  return steps.length > 0 ? `${steps.length} 个步骤` : "等待步骤";
}

function taskProgressSteps(state: SessionState): TaskProgressStep[] {
  if (state.turnStatus !== "inProgress" && state.approvals.length === 0) {
    return [];
  }
  const lastUserIndex = state.timeline.findLastIndex((entry) => entry.kind === "user");
  const currentTurnEntries = (lastUserIndex >= 0 ? state.timeline.slice(lastUserIndex + 1) : state.timeline)
    .filter((entry) => entry.kind !== "assistant" || entry.status === "inProgress")
    .filter((entry) => entry.kind !== "user");
  const entrySteps = currentTurnEntries.map((entry) => ({
    detail: progressStepDetail(entry),
    id: entry.id,
    label: progressStepLabel(entry),
    status: activityStatus(entry.status ?? (state.turnStatus === "inProgress" ? "inProgress" : "completed")),
    statusClass: progressStatusClass(entry.status),
  }));
  const approvalSteps = state.approvals.map((approval) => ({
    detail: approval.detail || approval.reason,
    id: String(approval.id),
    label: `等待审批 · ${approval.title}`,
    status: "待处理",
    statusClass: "waiting",
  }));
  return [...entrySteps, ...approvalSteps];
}

function progressStepLabel(entry: TimelineEntry): string {
  if (entry.kind === "command") {
    return "运行命令";
  }
  if (entry.kind === "file") {
    return "编辑文件";
  }
  if (entry.kind === "reasoning") {
    return "分析任务";
  }
  if (entry.kind === "assistant") {
    return "生成回复";
  }
  if (entry.kind === "error") {
    return "处理错误";
  }
  return entry.title;
}

function progressStepDetail(entry: TimelineEntry): string {
  if (entry.kind === "command") {
    return entry.title;
  }
  if (entry.kind === "reasoning") {
    return entry.content.trim().split(/\r?\n/)[0] ?? "";
  }
  return entry.content.trim().split(/\r?\n/)[0] || entry.title;
}

function progressStatusClass(status: string | null): string {
  return status === "completed"
    ? "completed"
    : status === "failed"
      ? "failed"
      : status === "interrupted"
        ? "interrupted"
        : "running";
}

function EnvironmentRow({
  accent = false,
  icon,
  label,
  muted = false,
  value,
}: {
  accent?: boolean;
  icon: string;
  label: string;
  muted?: boolean;
  value: string;
}) {
  return (
    <div className={`environment-row ${accent ? "accent" : ""} ${muted ? "muted" : ""}`}>
      <span aria-hidden="true">{icon}</span>
      <strong>{label}</strong>
      <small>{value}</small>
    </div>
  );
}

const DiffPanel = memo(function DiffPanel({
  currentProject,
  diffCount,
  diffFiles,
  files,
}: {
  currentProject: ProjectSummary | null;
  diffCount: string;
  diffFiles: number;
  files: DiffFile[];
}) {
  return (
    <section className="diff-panel">
      <div className="diff-heading">
        <div>
          <span>工作区 Diff</span>
          <strong>{diffFiles > 0 ? gitChangeSummary(currentProject, diffFiles) : "等待变更"}</strong>
        </div>
        <span className="diff-count">{diffCount}</span>
      </div>
      {files.length > 0 ? (
        <div className="diff-review">
          <div className="diff-file-list">
            {files.map((file) => (
              <div className="diff-file-row" key={file.id}>
                <span title={file.path}>{file.path}</span>
                <small>{file.section ?? "Runtime Diff"}</small>
                <i>+{file.additions} -{file.deletions}</i>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="empty-diff">
          <span>±</span>
          <strong>尚无文件变更</strong>
          <p>Agent 产生的修改会在这里实时显示。</p>
        </div>
      )}
    </section>
  );
});

const ActivityPanel = memo(function ActivityPanel({
  error,
  events,
}: {
  error: string | null;
  events: ThreadActivityEvent[];
}) {
  return (
    <section className="activity-panel">
      <div className="activity-heading">
        <div>
          <span>Runtime 审计记录</span>
          <strong>{events.length > 0 ? "最新事件优先" : "等待线程活动"}</strong>
        </div>
        <span>{events.length}</span>
      </div>
      {error && <p className="activity-error">{error}</p>}
      {events.length > 0 ? (
        <div className="activity-list">
          {events.map((event) => (
            <details className="activity-event" key={event.eventId}>
              <summary>
                <span className={`activity-direction ${event.protocol.direction}`}>
                  {event.protocol.direction === "clientToRuntime" ? "发送" : "接收"}
                </span>
                <div>
                  <strong>{event.protocol.method ?? "JSON-RPC 响应"}</strong>
                  <small>
                    {activityKindLabel(event.protocol.kind)} · {formatActivityTime(event.occurredAt)}
                  </small>
                </div>
              </summary>
              <pre>{JSON.stringify(event.protocol.message, null, 2)}</pre>
            </details>
          ))}
        </div>
      ) : (
        <div className="empty-activity">
          <span>◎</span>
          <strong>尚无活动记录</strong>
          <p>提交任务后，模型轮次、工具、审批与结果会在这里持久化展示。</p>
        </div>
      )}
    </section>
  );
});

function activityKindLabel(kind: ThreadActivityEvent["protocol"]["kind"]): string {
  return kind === "request" ? "请求" : kind === "response" ? "响应" : "通知";
}

function formatActivityTime(value: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(value);
}

type TimelineTurn = {
  entries: TimelineEntry[];
  user: TimelineEntry | null;
};

const Timeline = memo(function Timeline({
  entries,
  turnStatus,
}: {
  entries: readonly TimelineEntry[];
  turnStatus: SessionState["turnStatus"];
}) {
  const [now, setNow] = useState(Date.now());
  const turns = useMemo(() => groupTimeline(entries), [entries]);

  useEffect(() => {
    if (turnStatus !== "inProgress") {
      return;
    }
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [turnStatus]);

  return (
    <div className="timeline">
      {turns.map((turn, index) => {
        const active = turnStatus === "inProgress" && index === turns.length - 1;
        const duration = turnDuration(turn, active ? now : null);
        return (
          <section className="conversation-turn" key={turn.user?.id ?? `orphan-${index}`}>
            {turn.user && (
              <>
                <article className="user-message">
                  <p>{turn.user.content}</p>
                </article>
                {duration !== null && (
                  <div className="turn-processing">
                    <span>{active ? "处理中" : "已处理"} {formatProcessingDuration(duration)}</span>
                  </div>
                )}
              </>
            )}
            <div className="assistant-flow">
              {turn.entries.map((entry) =>
                entry.kind === "assistant" ? (
                  <article className="assistant-message" key={entry.id}>
                    <MarkdownContent content={entry.content || "等待输出…"} />
                  </article>
                ) : (
                  <TimelineActivity entry={entry} key={entry.id} />
                ),
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
});

const TimelineActivity = memo(function TimelineActivity({ entry }: { entry: TimelineEntry }) {
  return (
    <details className={`timeline-activity ${entry.kind}`}>
      <summary>
        <span className="timeline-activity-icon">{activityIcon(entry.kind)}</span>
        <strong>{activityLabel(entry)}</strong>
        {entry.status && <span>{activityStatus(entry.status)}</span>}
      </summary>
      {entry.content && <pre>{entry.content}</pre>}
    </details>
  );
});

function groupTimeline(entries: readonly TimelineEntry[]): TimelineTurn[] {
  const turns: TimelineTurn[] = [];
  for (const entry of entries) {
    if (entry.kind === "user") {
      turns.push({ user: entry, entries: [] });
      continue;
    }
    if (turns.length === 0) {
      turns.push({ user: null, entries: [] });
    }
    turns[turns.length - 1]?.entries.push(entry);
  }
  return turns;
}

function turnDuration(turn: TimelineTurn, activeNow: number | null): number | null {
  const startedAt = turn.user?.startedAt;
  if (startedAt === undefined) {
    return null;
  }
  if (activeNow !== null) {
    return Math.max(0, activeNow - startedAt);
  }
  const completedAt = [turn.user, ...turn.entries].reduce<number | null>(
    (latest, entry) =>
      entry?.completedAt === undefined ? latest : Math.max(latest ?? 0, entry.completedAt),
    null,
  );
  return completedAt === null ? null : Math.max(0, completedAt - startedAt);
}

function formatProcessingDuration(durationMs: number): string {
  const seconds = Math.max(1, Math.round(durationMs / 1_000));
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return minutes > 0 ? `${minutes}m ${remainingSeconds}s` : `${seconds}s`;
}

function activityIcon(kind: TimelineEntry["kind"]): string {
  return kind === "command"
    ? "⌘"
    : kind === "file"
      ? "↗"
      : kind === "reasoning"
        ? "◇"
        : kind === "error"
          ? "!"
          : "·";
}

function activityLabel(entry: TimelineEntry): string {
  if (entry.kind === "command") {
    return `运行命令 · ${entry.title}`;
  }
  if (entry.kind === "file") {
    return "编辑文件";
  }
  if (entry.kind === "reasoning") {
    return "查看思考过程";
  }
  return entry.title;
}

function activityStatus(status: string): string {
  return status === "inProgress"
    ? "进行中"
    : status === "completed"
      ? "已完成"
      : status === "failed"
        ? "失败"
        : status === "interrupted"
          ? "已停止"
          : status === "accept" || status === "acceptForSession"
            ? "已允许"
            : status === "decline" || status === "cancel"
              ? "已拒绝"
              : status === "diagnostic"
                ? "诊断"
                : status;
}

function ApprovalCard({
  approval,
  onDecision,
}: {
  approval: PendingApproval;
  onDecision: (decision: ApprovalDecision) => void;
}) {
  return (
    <article className="approval-card">
      <div className="approval-title">
        <span>!</span>
        <div>
          <strong>{approval.title}</strong>
          <p>{approval.reason}</p>
        </div>
      </div>
      <code>{approval.detail}</code>
      {(approval.cwd || approval.boundary || approval.network !== null) && (
        <dl className="approval-details">
          {approval.cwd && <><dt>工作目录</dt><dd>{approval.cwd}</dd></>}
          {approval.boundary && <><dt>授权边界</dt><dd>{approval.boundary}</dd></>}
          {approval.network !== null && (
            <><dt>网络访问</dt><dd>{approval.network ? "需要" : "不需要"}</dd></>
          )}
        </dl>
      )}
      <div className="approval-actions">
        <button type="button" onClick={() => onDecision("decline")}>拒绝</button>
        <button type="button" onClick={() => onDecision("acceptForSession")}>本次会话允许</button>
        <button className="primary" type="button" onClick={() => onDecision("accept")}>允许一次</button>
      </div>
    </article>
  );
}

function RuntimeErrorCard({
  error,
}: {
  error: NonNullable<SessionState["structuredError"]>;
}) {
  return (
    <article className="runtime-error-card" role="alert">
      <div>
        <span>{error.category}</span>
        <strong>{error.title}</strong>
      </div>
      <p>{error.message}</p>
      <small>处理建议：{error.hint}</small>
    </article>
  );
}

const ModelPicker = memo(function ModelPicker({
  model,
  onChange,
}: {
  model: "mimo-v2.5" | "mimo-v2.5-pro";
  onChange: (model: "mimo-v2.5" | "mimo-v2.5-pro") => void;
}) {
  return (
    <PopupSelect
      ariaLabel="模型"
      className="composer-popup-select model-picker"
      label="模型"
      options={MIMO_MODEL_OPTIONS}
      placement="top"
      value={model}
      onChange={(next) => onChange(next as typeof model)}
    />
  );
});

function ProjectPicker({
  currentProject,
  disabled,
  onSelectProject,
  projects,
}: {
  currentProject: ProjectSummary | null;
  disabled: boolean;
  onSelectProject: (projectId: string) => void | Promise<void>;
  projects: ProjectSummary[];
}) {
  const options = useMemo(
    () =>
      projects.map((project) => ({
        description: project.path,
        label: project.name,
        value: project.id,
      })),
    [projects],
  );

  if (options.length === 0) {
    return (
      <button className="project-meta-empty" disabled type="button">
        <span aria-hidden="true">▱</span>
        未选择项目
      </button>
    );
  }

  return (
    <PopupSelect
      ariaLabel="切换项目"
      className="project-meta-select"
      disabled={disabled}
      label="▱"
      options={options}
      placement="top"
      value={currentProject?.id ?? options[0]?.value ?? ""}
      onChange={(projectId) => {
        if (projectId !== currentProject?.id) {
          void onSelectProject(projectId);
        }
      }}
    />
  );
}

function SendArrowIcon() {
  return (
    <svg aria-hidden="true" className="send-icon" focusable="false" viewBox="0 0 20 20">
      <path d="M10 15.5V4.5" />
      <path d="M5.5 9L10 4.5L14.5 9" />
    </svg>
  );
}

function sandboxLabel(sandbox: "danger-full-access" | "read-only" | "workspace-write"): string {
  return sandbox === "read-only" ? "只读模式" : sandbox === "workspace-write" ? "工作区写入" : "完全访问";
}

function sandboxDescription(
  sandbox: "danger-full-access" | "read-only" | "workspace-write",
): string {
  if (sandbox === "read-only") {
    return "Agent 可以检查项目，但不能修改文件或运行具有副作用的命令。";
  }
  if (sandbox === "danger-full-access") {
    return "Agent 可以访问项目外内容。高风险操作仍会在活动记录中明确展示。";
  }
  return "Agent 可以修改当前项目；越界写入和敏感命令需要你的批准。";
}
