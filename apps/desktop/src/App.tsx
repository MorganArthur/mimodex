import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";

import {
  type ApprovalDecision,
  type DesktopSessionController,
  type PendingApproval,
  type SessionState,
  type TimelineEntry,
} from "@mimodex/desktop-core";
import type { ProjectSummary } from "./projects.js";
import type { ThreadRecord } from "./threads.js";

export type AppProps = {
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

const entryLabels: Record<TimelineEntry["kind"], string> = {
  approval: "确认",
  assistant: "AI",
  command: "RUN",
  error: "ERR",
  file: "FILE",
  reasoning: "THINK",
  status: "STATE",
  user: "YOU",
};

export function App({
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
  threadBusy,
  threadError,
  threads,
}: AppProps) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [model, setModel] = useState<"mimo-v2.5" | "mimo-v2.5-pro">("mimo-v2.5");
  const [sandbox, setSandbox] = useState<"danger-full-access" | "read-only" | "workspace-write">(
    "workspace-write",
  );
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const conversationRef = useRef<HTMLElement>(null);

  useEffect(() => {
    void session.connect().catch(() => undefined);
  }, [session]);

  useEffect(() => {
    if (state.threadId) {
      setModel(state.model === "mimo-v2.5-pro" ? "mimo-v2.5-pro" : "mimo-v2.5");
      setSandbox(state.sandbox);
    }
  }, [state.model, state.sandbox, state.threadId]);

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
            <Timeline entries={state.timeline} />
          )}
          {state.approvals.map((approval) => (
            <ApprovalCard
              approval={approval}
              key={String(approval.id)}
              onDecision={(decision) => void session.resolveApproval(approval.id, decision)}
            />
          ))}
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
                  onChange={(event) =>
                    setSandbox(
                      event.target.value as "danger-full-access" | "read-only" | "workspace-write",
                    )
                  }
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

      <aside className="context-panel">
        <div className="context-tabs">
          <button className="active" type="button">变更</button>
          <button type="button">活动</button>
        </div>
        <section className="context-summary">
          <p className="eyebrow">当前项目</p>
          <h2>{currentProject?.name ?? "尚未选择"}</h2>
          <p>{currentProject ? projectSummary(currentProject) : "添加项目后才能创建 Agent 任务。"}</p>
        </section>
        <section className="diff-panel">
          <div className="diff-heading">
            <div>
              <span>工作区 Diff</span>
              <strong>{state.diff ? "1 个文件" : "等待变更"}</strong>
            </div>
            <span className="diff-count">{state.diff ? "+1 -1" : "0"}</span>
          </div>
          {state.diff ? (
            <pre>{state.diff}</pre>
          ) : (
            <div className="empty-diff">
              <span>±</span>
              <strong>尚无文件变更</strong>
              <p>Agent 产生的修改会在这里实时显示。</p>
            </div>
          )}
        </section>
        <section className="runtime-card">
          <div>
            <span className={`connection-dot ${state.connection}`} />
            <strong>Runtime 状态</strong>
          </div>
          <dl>
            <div><dt>连接</dt><dd>{statusLabels[state.connection]}</dd></div>
            <div><dt>模型</dt><dd>{state.model}</dd></div>
            <div><dt>线程</dt><dd>{state.threadId ? "已创建" : "待创建"}</dd></div>
          </dl>
        </section>
      </aside>
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

function Timeline({ entries }: { entries: readonly TimelineEntry[] }) {
  return (
    <div className="timeline">
      {entries.map((entry) => (
        <article className={`timeline-entry ${entry.kind}`} key={entry.id}>
          <span className="entry-label">{entryLabels[entry.kind]}</span>
          <div>
            <div className="entry-heading">
              <strong>{entry.title}</strong>
              {entry.status && <span>{entry.status}</span>}
            </div>
            <p>{entry.content || "等待输出…"}</p>
          </div>
        </article>
      ))}
    </div>
  );
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
      <div className="approval-actions">
        <button type="button" onClick={() => onDecision("decline")}>拒绝</button>
        <button type="button" onClick={() => onDecision("acceptForSession")}>本次会话允许</button>
        <button className="primary" type="button" onClick={() => onDecision("accept")}>允许一次</button>
      </div>
    </article>
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
