import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from "react";

import {
  type ApprovalDecision,
  type DesktopSessionController,
  type PendingApproval,
  type SessionState,
  type TimelineEntry,
} from "@mimodex/desktop-core";
import { parseUnifiedDiff, type DiffFile } from "./diff.js";
import type { ProjectSummary } from "./projects.js";
import type { AppSettings } from "./settings.js";
import type { ThreadActivityEvent, ThreadRecord } from "./threads.js";

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
  const [fullAccessWarningOpen, setFullAccessWarningOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [contextTab, setContextTab] = useState<"activity" | "changes">("changes");
  const conversationRef = useRef<HTMLElement>(null);
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

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!message.trim() || !currentProject?.available || submitting) {
      return;
    }
    setSubmitting(true);
    try {
      await session.startTask({ text: message, projectPath: currentProject.path, model, sandbox });
      setMessage("");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">M</div>
          <div>
            <strong>Mimodex</strong>
            <span>本地编程 Agent</span>
          </div>
        </div>

        <button
          className="new-thread"
          disabled={
            !currentProject?.available ||
            projectBusy ||
            threadBusy ||
            state.turnStatus === "inProgress"
          }
          type="button"
          onClick={() => void onNewThread()}
        >
          <span>+</span>
          新建线程
        </button>

        <div className="sidebar-section">
          <div className="section-heading">
            <span>项目</span>
            <button
              disabled={projectBusy || state.turnStatus === "inProgress"}
              type="button"
              aria-label="添加项目"
              onClick={() => void onAddProject()}
            >
              +
            </button>
          </div>
          {projects.length === 0 ? (
            <button
              className="empty-projects"
              disabled={state.turnStatus === "inProgress"}
              type="button"
              onClick={() => void onAddProject()}
            >
              添加本地项目文件夹
            </button>
          ) : projects.map((project) => (
            <button
              className={`project-row ${project.id === currentProject?.id ? "active" : ""}`}
              disabled={projectBusy || state.turnStatus === "inProgress"}
              key={project.id}
              title={project.path}
              type="button"
              onClick={() => void onSelectProject(project.id)}
            >
              <span className="project-icon">{projectInitials(project.name)}</span>
              <div>
                <strong>{project.name}</strong>
                <span>{projectSubtitle(project)}</span>
              </div>
              <i className={project.git.dirty ? "dirty" : ""} />
            </button>
          ))}
          {projectError && <p className="sidebar-error">{projectError}</p>}
        </div>

        <div className="sidebar-section threads">
          <div className="section-heading">
            <span>最近线程</span>
          </div>
          {threads.length === 0 ? (
            <p className="empty-threads">这个项目还没有线程。</p>
          ) : (
            threads.map((thread) => (
              <ThreadRow
                active={thread.id === state.threadId}
                disabled={
                  projectBusy ||
                  threadBusy ||
                  state.turnStatus === "inProgress" ||
                  !currentProject?.available
                }
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
                  disabled={threadBusy || state.turnStatus === "inProgress"}
                  key={thread.id}
                  onDelete={() => {
                    if (
                      window.confirm(
                        `移除线程“${thread.title}”的 Mimodex 本地索引？Runtime 归档历史仍会保留。`,
                      )
                    ) {
                      void onDeleteThread(thread.id);
                    }
                  }}
                  onRestore={() => void onSetThreadArchived(thread.id, false)}
                  thread={thread}
                />
              ))}
            </details>
          )}
          {threadError && <p className="sidebar-error">{threadError}</p>}
        </div>

        <div className="sidebar-footer">
          <span className={`connection-dot ${state.connection}`} />
          <div>
            <strong>{statusLabels[state.connection]}</strong>
            <span>{state.platform ?? "本地演示连接"}</span>
          </div>
          <button type="button" aria-label="打开设置" onClick={onOpenSettings}>···</button>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">{currentProject ? projectBreadcrumb(currentProject) : "尚未选择项目"}</p>
            <h1>{currentProject?.name ?? "添加一个本地项目"}</h1>
          </div>
          <div className="topbar-actions">
            {currentProject && (
              <button
                className="refresh-project"
                disabled={projectBusy || state.turnStatus === "inProgress"}
                type="button"
                onClick={() => void onRefreshProject()}
              >
                {projectBusy ? "刷新中" : "刷新 Git"}
              </button>
            )}
            <span className="model-pill">{model}</span>
            {sandbox === "danger-full-access" && <span className="danger-pill">完全访问</span>}
            <span className={`run-status ${state.turnStatus}`}>
              {state.turnStatus === "inProgress" ? "执行中" : "就绪"}
            </span>
            {state.turnStatus === "inProgress" && (
              <button className="stop-button" type="button" onClick={() => void session.stop()}>
                停止
              </button>
            )}
          </div>
        </header>

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
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="描述你希望 Mimodex 在当前项目中完成的任务"
            rows={3}
          />
          <div className="composer-toolbar">
            <div className="composer-options">
              <label>
                <span>项目路径</span>
                <strong className="selected-project-path" title={currentProject?.path}>
                  {currentProject?.path ?? "请先添加项目"}
                </strong>
              </label>
              <label>
                <span>权限</span>
                <select
                  aria-label="权限模式"
                  value={sandbox}
                  onChange={(event) => {
                    const next = event.target.value as
                      | "danger-full-access"
                      | "read-only"
                      | "workspace-write";
                    if (next === "danger-full-access" && sandbox !== "danger-full-access") {
                      setFullAccessWarningOpen(true);
                    } else {
                      setSandbox(next);
                    }
                  }}
                >
                  <option value="read-only">只读</option>
                  <option value="workspace-write">工作区写入</option>
                  <option value="danger-full-access">完全访问</option>
                </select>
              </label>
              <ModelPicker model={model} onChange={setModel} />
            </div>
            <button
              className="send-button"
              type="submit"
              disabled={
                !message.trim() ||
                !currentProject?.available ||
                state.connection !== "ready" ||
                state.turnStatus === "inProgress" ||
                submitting
              }
            >
              {submitting ? "提交中" : "开始任务"}
              <span>↗</span>
            </button>
          </div>
        </form>
      </main>

      <aside className={`context-panel ${contextTab}`}>
        <div className="context-tabs">
          <button
            className={contextTab === "changes" ? "active" : ""}
            type="button"
            onClick={() => setContextTab("changes")}
          >
            变更
          </button>
          <button
            className={contextTab === "activity" ? "active" : ""}
            type="button"
            onClick={() => setContextTab("activity")}
          >
            活动
          </button>
        </div>
        <section className="context-summary">
          <p className="eyebrow">{contextTab === "changes" ? "当前项目" : "当前线程"}</p>
          <h2>
            {contextTab === "changes"
              ? currentProject?.name ?? "尚未选择"
              : state.threadId
                ? "Runtime 活动审计"
                : "尚未创建线程"}
          </h2>
          <p>
            {contextTab === "changes"
              ? currentProject
                ? projectSummary(currentProject)
                : "添加项目后才能创建 Agent 任务。"
              : state.threadId
                ? `已记录最近 ${activityEvents.length} 条线程协议事件。`
                : "提交任务或恢复历史线程后，这里会显示持久化活动。"}
          </p>
        </section>
        {contextTab === "changes" ? (
          <DiffPanel
            currentProject={currentProject}
            diffCount={diffCount}
            diffFiles={diffFiles}
            files={parsedDiffFiles}
          />
        ) : (
          <ActivityPanel error={activityError} events={activityEvents} />
        )}
        <section className="runtime-card">
          <div>
            <span className={`connection-dot ${state.connection}`} />
            <strong>Runtime 状态</strong>
          </div>
          <dl>
            <div><dt>连接</dt><dd>{statusLabels[state.connection]}</dd></div>
            <div><dt>模型</dt><dd>{state.model}</dd></div>
            <div><dt>线程</dt><dd>{state.threadId ? "已创建" : "待创建"}</dd></div>
            <div><dt>Token 总量</dt><dd>{formatTokens(state.tokenUsage?.totalTokens)}</dd></div>
            {state.tokenUsage && (
              <>
                <div><dt>输入 / 输出</dt><dd>{formatTokens(state.tokenUsage.inputTokens)} / {formatTokens(state.tokenUsage.outputTokens)}</dd></div>
                <div><dt>缓存 / 推理</dt><dd>{formatTokens(state.tokenUsage.cachedInputTokens)} / {formatTokens(state.tokenUsage.reasoningOutputTokens)}</dd></div>
                <div><dt>上下文窗口</dt><dd>{formatTokens(state.tokenUsage.contextWindow)}</dd></div>
              </>
            )}
          </dl>
        </section>
      </aside>
      {fullAccessWarningOpen && (
        <FullAccessWarning
          onCancel={() => setFullAccessWarningOpen(false)}
          onConfirm={() => {
            setSandbox("danger-full-access");
            setFullAccessWarningOpen(false);
          }}
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
      <span className="welcome-kicker">LOCAL-FIRST CODING AGENT</span>
      <h2>把任务交给 MiMo，<br />把每一步留在你眼前。</h2>
      <p>当前项目为 {project.name}。输入任务后，Agent 将以该文件夹作为工作目录。</p>
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

function projectInitials(name: string): string {
  return name.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, "").slice(0, 2).toUpperCase() || "PR";
}

function projectSubtitle(project: ProjectSummary): string {
  if (!project.available) {
    return "文件夹不可用";
  }
  if (!project.git.isRepository) {
    return "非 Git 文件夹";
  }
  const branch = project.git.branch ?? project.git.head ?? "Git 仓库";
  const changes = project.git.changedFiles + project.git.untrackedFiles;
  return changes > 0 ? `${branch} · ${changes} 项变更` : branch;
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

function DiffPanel({
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
}

function ActivityPanel({
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
}

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

function Timeline({
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
                    <p>{entry.content || "等待输出…"}</p>
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
}

function TimelineActivity({ entry }: { entry: TimelineEntry }) {
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
}

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

function FullAccessWarning({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="settings-backdrop full-access-backdrop" role="presentation">
      <section
        aria-label="启用完全访问"
        aria-modal="true"
        className="full-access-dialog"
        role="dialog"
      >
        <p className="eyebrow">高风险权限</p>
        <h2>启用完全访问？</h2>
        <p>
          Agent 将能够访问当前项目之外的文件并运行具有系统级副作用的命令。请只在明确需要时启用，
          并仔细审阅每项操作。
        </p>
        <div>
          <button type="button" onClick={onCancel}>保持工作区写入</button>
          <button className="danger-confirm" type="button" onClick={onConfirm}>确认启用完全访问</button>
        </div>
      </section>
    </div>
  );
}

function ModelPicker({
  model,
  onChange,
}: {
  model: "mimo-v2.5" | "mimo-v2.5-pro";
  onChange: (model: "mimo-v2.5" | "mimo-v2.5-pro") => void;
}) {
  return (
    <details className="model-picker">
      <summary>
        <span>模型</span>
        <strong>{model}</strong>
      </summary>
      <div className="model-popover">
        <button
          className={model === "mimo-v2.5" ? "selected" : ""}
          type="button"
          onClick={() => onChange("mimo-v2.5")}
        >
          <strong>mimo-v2.5</strong>
          <span>默认模型，适合日常编程任务</span>
        </button>
        <div className="advanced-label">高级模型</div>
        <button
          className={model === "mimo-v2.5-pro" ? "selected" : ""}
          type="button"
          onClick={() => onChange("mimo-v2.5-pro")}
        >
          <strong>mimo-v2.5-pro</strong>
          <span>复杂任务与更深推理</span>
        </button>
      </div>
    </details>
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
