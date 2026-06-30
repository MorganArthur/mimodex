import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import {
  type ApprovalDecision,
  type DesktopSessionController,
  type ImageAttachment,
  type PendingApproval,
  type SessionState,
  type TimelineEntry,
} from "@mimodex/desktop-core";
import {
  AUTOMATION_CADENCE_OPTIONS,
  AUTOMATION_WEEKDAY_OPTIONS,
  type AutomationCadence,
  type AutomationDraft,
  type AutomationRecord,
} from "./automation.js";
import { ConfirmationDialog } from "./ConfirmationDialog.js";
import { parseUnifiedDiff, type DiffFile } from "./diff.js";
import { MarkdownContent } from "./MarkdownContent.js";
import { MIMO_MODEL_OPTIONS, PopupSelect, SANDBOX_OPTIONS } from "./PopupSelect.js";
import type { ProjectSummary } from "./projects.js";
import type { AppSettings } from "./settings.js";
import {
  createTerminalService,
  type EmbeddedTerminalService,
  type TerminalSnapshot,
} from "./terminal.js";
import type { ThreadActivityEvent, ThreadRecord } from "./threads.js";
import { APP_VERSION } from "./version.js";

export type AppProps = {
  activityError: string | null;
  activityEvents: ThreadActivityEvent[];
  automationBusy?: boolean;
  automationError?: string | null;
  automations?: AutomationRecord[];
  archivedThreads: ThreadRecord[];
  currentProject: ProjectSummary | null;
  onAddProject: () => void | Promise<void>;
  onCreateAutomation?: (draft: AutomationDraft) => void | Promise<void>;
  onDeleteAutomation?: (automationId: string) => void | Promise<void>;
  onDeleteThread: (threadId: string) => void | Promise<void>;
  onLoadBranches?: (projectId: string) => Promise<string[]>;
  onNewThread: () => void | Promise<void>;
  onOpenSettings?: () => void;
  onRefreshProject: () => void | Promise<void>;
  onRunAutomation?: (automationId: string) => void | Promise<void>;
  onSelectProject: (projectId: string) => void | Promise<void>;
  onSelectThread: (threadId: string) => void | Promise<void>;
  onSetThreadArchived: (threadId: string, archived: boolean) => void | Promise<void>;
  onSwitchBranch?: (projectId: string, branch: string) => void | Promise<void>;
  onUpdateAutomation?: (automationId: string, draft: AutomationDraft) => void | Promise<void>;
  projectBusy: boolean;
  projectError: string | null;
  projects: ProjectSummary[];
  runningAutomationIds?: string[];
  session: DesktopSessionController;
  settings: AppSettings;
  terminalService?: EmbeddedTerminalService;
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

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_COUNT = 4;
const defaultTerminalService = createTerminalService();

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`读取 ${file.name} 失败`));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") {
        resolve(result);
      } else {
        reject(new Error(`读取 ${file.name} 失败`));
      }
    };
    reader.readAsDataURL(file);
  });
}

function formatFileSize(sizeBytes: number): string {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return "0 B";
  }
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }
  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`;
  }
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

type UiIconName =
  | "branch"
  | "clock"
  | "commit"
  | "diff"
  | "folder"
  | "github"
  | "laptop"
  | "menu"
  | "plus"
  | "refresh"
  | "settings"
  | "square-pen"
  | "terminal";

function UiIcon({ name }: { name: UiIconName }) {
  return (
    <svg aria-hidden="true" className="ui-icon" focusable="false" viewBox="0 0 20 20">
      {iconPaths[name]}
    </svg>
  );
}

const iconPaths: Record<UiIconName, ReactNode> = {
  branch: (
    <>
      <circle cx="5.5" cy="4.5" r="1.6" />
      <circle cx="5.5" cy="15.5" r="1.6" />
      <circle cx="14.5" cy="8" r="1.6" />
      <path d="M5.5 6.1v7.8" />
      <path d="M7.1 4.5h2.4a3 3 0 0 1 3 3v.5" />
    </>
  ),
  clock: (
    <>
      <circle cx="10" cy="10" r="7" />
      <path d="M10 6.2v4.1l2.7 1.7" />
    </>
  ),
  commit: (
    <>
      <path d="M3.5 10h4" />
      <circle cx="10" cy="10" r="2.3" />
      <path d="M12.3 10h4.2" />
    </>
  ),
  diff: (
    <>
      <rect x="4.5" y="4" width="11" height="12" rx="1.8" />
      <path d="M10 7.5v5" />
      <path d="M7.5 10h5" />
    </>
  ),
  folder: (
    <>
      <path d="M3 6.6h5l1.6 1.8H17" />
      <path d="M3 6.6v8.8a1.4 1.4 0 0 0 1.4 1.4h11.2a1.4 1.4 0 0 0 1.4-1.4V8.4a1.4 1.4 0 0 0-1.4-1.4H9.1" />
    </>
  ),
  github: (
    <>
      <path d="M8.2 16.8c-4.1 1.2-4.1-1.8-5.7-2.2" />
      <path d="M11.8 18v-3.1c0-.8-.3-1.4-.8-1.8 2.7-.3 5.5-1.3 5.5-5.8a4.6 4.6 0 0 0-1.2-3.2c.1-.3.5-1.6-.1-3.1 0 0-1-.3-3.3 1.2a11.1 11.1 0 0 0-6 0C3.6.7 2.6 1 2.6 1c-.6 1.5-.2 2.8-.1 3.1a4.6 4.6 0 0 0-1.2 3.2c0 4.5 2.8 5.5 5.5 5.8-.4.4-.7 1-.8 1.8V18" />
    </>
  ),
  laptop: (
    <>
      <rect x="4" y="5" width="12" height="8.5" rx="1.3" />
      <path d="M2.8 16h14.4" />
      <path d="M7.7 13.5h4.6" />
    </>
  ),
  menu: (
    <>
      <path d="M5 6.6h10" />
      <path d="M5 10h10" />
      <path d="M5 13.4h10" />
    </>
  ),
  plus: (
    <>
      <path d="M10 4.8v10.4" />
      <path d="M4.8 10h10.4" />
    </>
  ),
  refresh: (
    <>
      <path d="M15.8 7.8A5.8 5.8 0 0 0 5.3 5.6L4 7.4" />
      <path d="M4 3.9v3.5h3.5" />
      <path d="M4.2 12.2a5.8 5.8 0 0 0 10.5 2.2l1.3-1.8" />
      <path d="M16 16.1v-3.5h-3.5" />
    </>
  ),
  settings: (
    <>
      <circle cx="10" cy="10" r="2.4" />
      <path d="M8.8 2.9h2.4l.4 2.1c.5.1.9.3 1.3.5l1.8-1.2 1.7 1.7-1.2 1.8c.2.4.4.8.5 1.3l2.1.4v2.4l-2.1.4c-.1.5-.3.9-.5 1.3l1.2 1.8-1.7 1.7-1.8-1.2c-.4.2-.8.4-1.3.5l-.4 2.1H8.8l-.4-2.1c-.5-.1-.9-.3-1.3-.5l-1.8 1.2-1.7-1.7 1.2-1.8c-.2-.4-.4-.8-.5-1.3l-2.1-.4V9.5l2.1-.4c.1-.5.3-.9.5-1.3L3.6 6l1.7-1.7 1.8 1.2c.4-.2.8-.4 1.3-.5l.4-2.1Z" />
    </>
  ),
  "square-pen": (
    <>
      <rect x="3.8" y="3.8" width="12.4" height="12.4" rx="2.4" />
      <path d="M8.3 12.4l.5-2.4 4.4-4.4a1.2 1.2 0 0 1 1.7 1.7l-4.4 4.4-2.2.7Z" />
      <path d="M12.2 6.6l1.2 1.2" />
    </>
  ),
  terminal: (
    <>
      <rect x="3" y="4.5" width="14" height="11" rx="1.6" />
      <path d="M6.4 8.4l2.2 1.8-2.2 1.8" />
      <path d="M10.4 12.6h3.4" />
    </>
  ),
};

export function App({
  activityError,
  activityEvents,
  automationBusy = false,
  automationError = null,
  automations = [],
  archivedThreads,
  currentProject,
  onAddProject,
  onCreateAutomation = () => undefined,
  onDeleteAutomation = () => undefined,
  onDeleteThread,
  onLoadBranches,
  onNewThread,
  onOpenSettings = () => undefined,
  onRefreshProject,
  onRunAutomation = () => undefined,
  onSelectProject,
  onSelectThread,
  onSetThreadArchived,
  onSwitchBranch,
  onUpdateAutomation = () => undefined,
  projectBusy,
  projectError,
  projects,
  runningAutomationIds = [],
  session,
  settings,
  terminalService = defaultTerminalService,
  threadBusy,
  threadError,
  threads,
}: AppProps) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [activeView, setActiveView] = useState<"automation" | "chat">("chat");
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
  const [terminalPanelEnabled, setTerminalPanelEnabled] = useState(false);
  const [terminalVisible, setTerminalVisible] = useState(false);
  const [attachedImages, setAttachedImages] = useState<ImageAttachment[]>([]);
  const [imageError, setImageError] = useState<string | null>(null);
  const [imagePickerBusy, setImagePickerBusy] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
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

  useEffect(() => {
    if (!currentProject?.available) {
      setTerminalVisible(false);
    }
  }, [currentProject?.available]);

  const canSubmit =
    (Boolean(message.trim()) || attachedImages.length > 0) &&
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
      await session.startTask({
        text: message,
        projectPath: currentProject.path,
        model,
        sandbox,
        images: attachedImages,
      });
      setMessage("");
      setAttachedImages([]);
      setImageError(null);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const removeAttachedImage = (id: string) => {
    setAttachedImages((current) => current.filter((image) => image.id !== id));
  };

  const handleImageInputChange = async (files: FileList | null) => {
    if (!files || files.length === 0) {
      return;
    }
    setImagePickerBusy(true);
    setImageError(null);
    try {
      const next: ImageAttachment[] = [];
      for (const file of Array.from(files)) {
        if (!file.type.startsWith("image/")) {
          setImageError(`仅支持图片文件：${file.name}`);
          continue;
        }
        if (file.size > MAX_IMAGE_BYTES) {
          setImageError(`图片体积超出限制（${formatFileSize(MAX_IMAGE_BYTES)}）：${file.name}`);
          continue;
        }
        const dataUrl = await readFileAsDataUrl(file);
        next.push({
          id: `image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: file.name,
          mimeType: file.type || "image/*",
          sizeBytes: file.size,
          dataUrl,
        });
      }
      if (next.length > 0) {
        setAttachedImages((current) => [...current, ...next].slice(0, MAX_IMAGE_COUNT));
      }
    } catch (error) {
      setImageError(error instanceof Error ? error.message : String(error));
    } finally {
      setImagePickerBusy(false);
      if (imageInputRef.current) {
        imageInputRef.current.value = "";
      }
    }
  };

  const openImagePicker = () => {
    if (imagePickerBusy || attachedImages.length >= MAX_IMAGE_COUNT) {
      return;
    }
    imageInputRef.current?.click();
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
            className={`nav-command ${activeView === "chat" ? "active" : ""}`}
            disabled={!currentProject?.available || projectBusy || threadBusy}
            type="button"
            onClick={() => {
              setActiveView("chat");
              void onNewThread();
            }}
          >
            <span aria-hidden="true">
              <UiIcon name="square-pen" />
            </span>
            新对话
          </button>
          <button
            aria-label="自动化"
            className={`nav-command ${activeView === "automation" ? "active" : ""}`}
            type="button"
            onClick={() => setActiveView("automation")}
          >
            <span aria-hidden="true">
              <UiIcon name="clock" />
            </span>
            自动化
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
                    <span className="project-icon" aria-hidden="true">
                      <UiIcon name="folder" />
                    </span>
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
                            onSelect={() => {
                              setActiveView("chat");
                              void onSelectThread(thread.id);
                            }}
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
            <span aria-hidden="true">
              <UiIcon name="settings" />
            </span>
            设置
          </button>
          <span className="app-version">当前版本 v{APP_VERSION}</span>
        </div>
      </aside>

      {activeView === "automation" ? (
        <main className="workspace automation-workspace-shell">
          <AutomationWorkspace
            automations={automations}
            busy={automationBusy}
            currentProject={currentProject}
            error={automationError}
            projects={projects}
            runningAutomationIds={runningAutomationIds}
            settings={settings}
            onAddProject={onAddProject}
            onCreateAutomation={onCreateAutomation}
            onDeleteAutomation={onDeleteAutomation}
            onRunAutomation={onRunAutomation}
            onUpdateAutomation={onUpdateAutomation}
          />
        </main>
      ) : (
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
                  <span aria-hidden="true">
                    <UiIcon name="refresh" />
                  </span>
                  {projectBusy ? "刷新中" : "刷新 Git"}
                </button>
              )}
              {currentProject?.available && (
                <button
                  aria-label={terminalVisible ? "隐藏终端" : "打开终端"}
                  aria-pressed={terminalVisible}
                  className={`refresh-project open-terminal ${terminalVisible ? "active" : ""}`}
                  title={terminalVisible ? "隐藏底部终端面板" : `在 ${currentProject.path} 打开底部终端面板`}
                  type="button"
                  onClick={() => {
                    setTerminalPanelEnabled(true);
                    setTerminalVisible((visible) => !visible);
                  }}
                >
                  <span aria-hidden="true">
                    <UiIcon name="terminal" />
                  </span>
                  {terminalVisible ? "隐藏终端" : "打开终端"}
                </button>
              )}
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

          <div className={`workspace-stage ${terminalVisible && currentProject?.available ? "with-terminal" : ""}`}>
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
              {attachedImages.length > 0 && (
                <div className="composer-attachments" role="list" aria-label="已附带的图片">
                  {attachedImages.map((image) => (
                    <div className="composer-attachment" key={image.id} role="listitem">
                      <img alt={image.name} src={image.dataUrl} />
                      <div className="composer-attachment-meta">
                        <span title={image.name}>{image.name}</span>
                        <small>{formatFileSize(image.sizeBytes)}</small>
                      </div>
                      <button
                        aria-label={`移除 ${image.name}`}
                        className="composer-attachment-remove"
                        type="button"
                        onClick={() => removeAttachedImage(image.id)}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {imageError && <p className="composer-attachment-error">{imageError}</p>}
              <input
                aria-hidden="true"
                accept="image/*"
                className="composer-image-input"
                multiple
                ref={imageInputRef}
                tabIndex={-1}
                type="file"
                onChange={(event) => void handleImageInputChange(event.target.files)}
              />
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
                  aria-label="添加图片"
                  className="composer-icon-button"
                  disabled={
                    !currentProject?.available ||
                    imagePickerBusy ||
                    attachedImages.length >= MAX_IMAGE_COUNT
                  }
                  title={
                    attachedImages.length >= MAX_IMAGE_COUNT
                      ? `最多附带 ${MAX_IMAGE_COUNT} 张图片`
                      : "添加图片"
                  }
                  type="button"
                  onClick={openImagePicker}
                >
                  <UiIcon name="plus" />
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
                <BranchPicker
                  currentProject={currentProject}
                  disabled={projectBusy}
                  onLoadBranches={onLoadBranches}
                  onSwitchBranch={onSwitchBranch}
                />
              </div>
            </form>
            {terminalPanelEnabled && currentProject?.available && (
              <EmbeddedTerminalPanel
                key={currentProject.id}
                project={currentProject}
                terminalService={terminalService}
                visible={terminalVisible}
                onHide={() => setTerminalVisible(false)}
              />
            )}
          </div>
        </section>
      </main>
      )}
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

function EmbeddedTerminalPanel({
  onHide,
  project,
  terminalService,
  visible,
}: {
  onHide: () => void;
  project: ProjectSummary;
  terminalService: EmbeddedTerminalService;
  visible: boolean;
}) {
  const [restartToken, setRestartToken] = useState(0);
  const terminalSession = useMemo(
    () => terminalService.createSession(project.path),
    [project.path, restartToken, terminalService],
  );
  const [snapshot, setSnapshot] = useState<TerminalSnapshot>(() => terminalSession.getSnapshot());
  const [command, setCommand] = useState("");
  const outputRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    setSnapshot(terminalSession.getSnapshot());
    const unsubscribe = terminalSession.subscribe(() => {
      setSnapshot(terminalSession.getSnapshot());
    });
    void terminalSession.start();
    return () => {
      unsubscribe();
      void terminalSession.stop();
    };
  }, [terminalSession]);

  useEffect(() => {
    if (!visible || !outputRef.current) {
      return;
    }
    outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [snapshot.output, visible]);

  const submitCommand = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (snapshot.status !== "running") {
      return;
    }
    const input = command;
    setCommand("");
    await terminalSession.send(input);
  };

  return (
    <section
      aria-label="底部终端"
      className="embedded-terminal"
      hidden={!visible}
    >
      <header className="embedded-terminal-header">
        <button
          aria-current="page"
          className="embedded-terminal-tab"
          title={snapshot.projectPath}
          type="button"
        >
          <UiIcon name="terminal" />
          <span>{project.name}</span>
        </button>
        <button
          aria-label="新建终端"
          className="embedded-terminal-icon-button"
          title="重启终端"
          type="button"
          onClick={() => setRestartToken((value) => value + 1)}
        >
          +
        </button>
        <div className="embedded-terminal-spacer" />
        <span className={`embedded-terminal-status ${snapshot.status}`}>
          {terminalStatusLabel(snapshot)}
        </span>
        <button
          aria-label="关闭终端"
          className="embedded-terminal-icon-button"
          type="button"
          onClick={onHide}
        >
          ×
        </button>
      </header>
      <div className="embedded-terminal-body">
        <pre className="embedded-terminal-output" ref={outputRef}>
          {snapshot.output.map((chunk) => (
            <span className={`terminal-stream ${chunk.stream}`} key={chunk.id}>
              {chunk.text}
            </span>
          ))}
        </pre>
        <form className="embedded-terminal-input-row" onSubmit={(event) => void submitCommand(event)}>
          <span aria-hidden="true">&gt;</span>
          <input
            aria-label="终端命令"
            autoComplete="off"
            disabled={snapshot.status !== "running"}
            spellCheck={false}
            value={command}
            onChange={(event) => setCommand(event.target.value)}
          />
        </form>
      </div>
    </section>
  );
}

function terminalStatusLabel(snapshot: TerminalSnapshot): string {
  if (snapshot.status === "starting") {
    return "启动中";
  }
  if (snapshot.status === "running") {
    return snapshot.shellLabel;
  }
  if (snapshot.status === "exited") {
    return snapshot.exitCode === null ? "已退出" : `已退出 ${snapshot.exitCode}`;
  }
  if (snapshot.status === "error") {
    return snapshot.error ?? "启动失败";
  }
  return "待启动";
}

function AutomationWorkspace({
  automations,
  busy,
  currentProject,
  error,
  onAddProject,
  onCreateAutomation,
  onDeleteAutomation,
  onRunAutomation,
  onUpdateAutomation,
  projects,
  runningAutomationIds,
  settings,
}: {
  automations: AutomationRecord[];
  busy: boolean;
  currentProject: ProjectSummary | null;
  error: string | null;
  onAddProject: () => void | Promise<void>;
  onCreateAutomation: (draft: AutomationDraft) => void | Promise<void>;
  onDeleteAutomation: (automationId: string) => void | Promise<void>;
  onRunAutomation: (automationId: string) => void | Promise<void>;
  onUpdateAutomation: (automationId: string, draft: AutomationDraft) => void | Promise<void>;
  projects: ProjectSummary[];
  runningAutomationIds: string[];
  settings: AppSettings;
}) {
  const defaultProject = currentProject ?? projects[0] ?? null;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [fullAccessWarningOpen, setFullAccessWarningOpen] = useState(false);
  const [draft, setDraft] = useState<AutomationDraft>(() =>
    defaultAutomationDraft(defaultProject, settings),
  );
  const projectOptions = useMemo(
    () =>
      projects.map((project) => ({
        description: project.path,
        label: project.name,
        value: project.id,
      })),
    [projects],
  );
  const weekdayOptions = useMemo(
    () =>
      AUTOMATION_WEEKDAY_OPTIONS.map((option) => ({
        label: option.label,
        value: String(option.value),
      })),
    [],
  );
  const runningIds = useMemo(() => new Set(runningAutomationIds), [runningAutomationIds]);

  useEffect(() => {
    if (draft.projectId || !defaultProject) {
      return;
    }
    setDraft((current) => ({ ...current, projectId: defaultProject.id }));
  }, [defaultProject, draft.projectId]);

  const selectedProject =
    projects.find((project) => project.id === draft.projectId) ?? defaultProject;
  const canSave = Boolean(draft.projectId && draft.title.trim() && draft.prompt.trim()) && !busy;

  const submitAutomation = (event: FormEvent) => {
    event.preventDefault();
    if (!canSave) {
      return;
    }
    const action = editingId
      ? onUpdateAutomation(editingId, draft)
      : onCreateAutomation(draft);
    void Promise.resolve(action).then(() => {
      setEditingId(null);
      setDraft(defaultAutomationDraft(selectedProject, settings));
    });
  };

  const editAutomation = (automation: AutomationRecord) => {
    setEditingId(automation.id);
    setDraft(automationDraftFromRecord(automation));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft(defaultAutomationDraft(defaultProject, settings));
  };

  const updateDraft = <K extends keyof AutomationDraft>(key: K, value: AutomationDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  return (
    <section className="automation-workspace">
      <header className="automation-topbar">
        <div>
          <p className="eyebrow">自动化</p>
          <h1>任务调度</h1>
        </div>
        {projects.length === 0 && (
          <button className="automation-secondary-action" type="button" onClick={() => void onAddProject()}>
            添加项目
          </button>
        )}
      </header>

      <div className="automation-stage">
        <form className="automation-form" onSubmit={submitAutomation}>
          <div className="automation-form-heading">
            <div>
              <span>{editingId ? "编辑任务" : "新建任务"}</span>
              <strong>{selectedProject?.name ?? "未选择项目"}</strong>
            </div>
            {editingId && (
              <button className="automation-link-button" type="button" onClick={cancelEdit}>
                取消
              </button>
            )}
          </div>
          <label>
            <span>名称</span>
            <input
              aria-label="自动化名称"
              disabled={busy}
              value={draft.title}
              onChange={(event) => updateDraft("title", event.target.value)}
            />
          </label>
          <label>
            <span>项目</span>
            <PopupSelect
              ariaLabel="自动化项目"
              className="automation-field-select"
              disabled={busy || projectOptions.length === 0}
              label={<UiIcon name="folder" />}
              options={projectOptions.length > 0 ? projectOptions : [{ label: "无项目", value: "" }]}
              value={draft.projectId}
              onChange={(projectId) => updateDraft("projectId", projectId)}
            />
          </label>
          <div className="automation-form-grid">
            <label>
              <span>频率</span>
              <PopupSelect
                ariaLabel="自动化频率"
                className="automation-field-select"
                disabled={busy}
                label={<UiIcon name="clock" />}
                options={AUTOMATION_CADENCE_OPTIONS}
                value={draft.cadence}
                onChange={(cadence) => {
                  const nextCadence = cadence as AutomationCadence;
                  setDraft((current) => ({
                    ...current,
                    cadence: nextCadence,
                    enabled: nextCadence === "manual" ? false : current.enabled,
                  }));
                }}
              />
            </label>
            <label>
              <span>{draft.cadence === "hourly" ? "分钟" : "时间"}</span>
              <input
                aria-label="自动化时间"
                disabled={busy || draft.cadence === "manual"}
                type="time"
                value={draft.timeOfDay}
                onChange={(event) => updateDraft("timeOfDay", event.target.value)}
              />
            </label>
            {draft.cadence === "weekly" && (
              <label>
                <span>星期</span>
                <PopupSelect
                  ariaLabel="自动化星期"
                  className="automation-field-select"
                  disabled={busy}
                  label={<UiIcon name="clock" />}
                  options={weekdayOptions}
                  value={String(draft.dayOfWeek ?? 1)}
                  onChange={(day) => updateDraft("dayOfWeek", Number(day))}
                />
              </label>
            )}
          </div>
          <div className="automation-form-grid">
            <label>
              <span>模型</span>
              <PopupSelect
                ariaLabel="自动化模型"
                className="automation-field-select"
                disabled={busy}
                label="模型"
                options={MIMO_MODEL_OPTIONS}
                value={draft.model}
                onChange={(model) => updateDraft("model", model as AutomationDraft["model"])}
              />
            </label>
            <label>
              <span>权限</span>
              <PopupSelect
                ariaLabel="自动化权限"
                className="automation-field-select"
                disabled={busy}
                label="权限"
                options={SANDBOX_OPTIONS}
                value={draft.sandbox}
                onChange={(sandbox) => {
                  if (sandbox === "danger-full-access" && draft.sandbox !== "danger-full-access") {
                    setFullAccessWarningOpen(true);
                  } else {
                    updateDraft("sandbox", sandbox as AutomationDraft["sandbox"]);
                  }
                }}
              />
            </label>
          </div>
          <label className="automation-prompt-field">
            <span>任务提示词</span>
            <textarea
              aria-label="自动化任务提示词"
              disabled={busy}
              rows={7}
              value={draft.prompt}
              onChange={(event) => updateDraft("prompt", event.target.value)}
            />
          </label>
          <label className="automation-toggle">
            <input
              aria-label="创建后按计划自动运行"
              checked={draft.enabled}
              disabled={busy || draft.cadence === "manual"}
              type="checkbox"
              onChange={(event) => updateDraft("enabled", event.target.checked)}
            />
            <span>创建后按计划自动运行</span>
          </label>
          {error && <p className="automation-error">{error}</p>}
          <button className="automation-primary-action" disabled={!canSave} type="submit">
            {busy ? "保存中" : editingId ? "保存任务" : "创建任务"}
          </button>
        </form>
        {fullAccessWarningOpen && (
          <ConfirmationDialog
            cancelLabel="保持当前权限"
            confirmLabel="允许完全访问"
            description="自动化任务会在后台运行。完全访问允许 Agent 访问项目外内容并运行具有系统级副作用的命令。"
            eyebrow="高风险权限"
            onCancel={() => setFullAccessWarningOpen(false)}
            onConfirm={() => {
              updateDraft("sandbox", "danger-full-access");
              setFullAccessWarningOpen(false);
            }}
            title="允许自动化使用完全访问？"
            tone="danger"
          />
        )}

        <section className="automation-list" aria-label="自动化任务列表">
          {automations.length === 0 ? (
            <div className="automation-empty">
              <strong>暂无自动化任务</strong>
              <span>创建后会显示运行状态和下次触发时间。</span>
            </div>
          ) : (
            automations.map((automation) => {
              const project = projects.find((candidate) => candidate.id === automation.projectId);
              const running = runningIds.has(automation.id) || automation.lastStatus === "running";
              return (
                <article className="automation-item" key={automation.id}>
                  <div className="automation-item-main">
                    <span className={`automation-state-dot ${automationStatusClass(automation, running)}`} />
                    <div>
                      <strong>{automation.title}</strong>
                      <small>{project?.name ?? "项目已移除"} · {automationScheduleLabel(automation)}</small>
                    </div>
                  </div>
                  <dl>
                    <div>
                      <dt>下次运行</dt>
                      <dd>{automation.nextRunAt ? formatDateTime(automation.nextRunAt) : "手动"}</dd>
                    </div>
                    <div>
                      <dt>最近结果</dt>
                      <dd>{automationLastRunLabel(automation, running)}</dd>
                    </div>
                  </dl>
                  {automation.lastError && <p>{automation.lastError}</p>}
                  <div className="automation-item-actions">
                    <button
                      disabled={busy || running || !project?.available}
                      type="button"
                      onClick={() => void onRunAutomation(automation.id)}
                    >
                      {running ? "运行中" : "运行"}
                    </button>
                    <button disabled={busy || running} type="button" onClick={() => editAutomation(automation)}>
                      编辑
                    </button>
                    <button
                      disabled={busy}
                      type="button"
                      onClick={() =>
                        void onUpdateAutomation(automation.id, {
                          ...automationDraftFromRecord(automation),
                          enabled: !automation.enabled,
                        })
                      }
                    >
                      {automation.enabled ? "停用" : "启用"}
                    </button>
                    <button
                      className="danger"
                      disabled={busy || running}
                      type="button"
                      onClick={() => void onDeleteAutomation(automation.id)}
                    >
                      删除
                    </button>
                  </div>
                </article>
              );
            })
          )}
        </section>
      </div>
    </section>
  );
}

function defaultAutomationDraft(
  project: ProjectSummary | null,
  settings: AppSettings,
): AutomationDraft {
  return {
    cadence: "daily",
    dayOfWeek: 1,
    enabled: true,
    model: settings.defaultModel,
    projectId: project?.id ?? "",
    prompt: "检查当前项目状态，执行必要验证，并报告需要关注的问题。",
    sandbox: settings.defaultSandbox,
    timeOfDay: defaultTimeOfDay(),
    title: "每日项目体检",
  };
}

function automationDraftFromRecord(automation: AutomationRecord): AutomationDraft {
  return {
    cadence: automation.cadence,
    dayOfWeek: automation.dayOfWeek,
    enabled: automation.enabled,
    model: automation.model,
    projectId: automation.projectId,
    prompt: automation.prompt,
    sandbox: automation.sandbox,
    timeOfDay: automation.timeOfDay,
    title: automation.title,
  };
}

function defaultTimeOfDay(): string {
  const date = new Date(Date.now() + 3_600_000);
  return `${date.getHours().toString().padStart(2, "0")}:00`;
}

function automationScheduleLabel(automation: AutomationRecord): string {
  if (automation.cadence === "manual") {
    return "手动";
  }
  if (automation.cadence === "hourly") {
    const minute = automation.timeOfDay.split(":")[1] ?? "00";
    return `每小时 ${minute} 分`;
  }
  if (automation.cadence === "weekly") {
    const weekday =
      AUTOMATION_WEEKDAY_OPTIONS.find((option) => option.value === automation.dayOfWeek)?.label ??
      "周一";
    return `每周 ${weekday} ${automation.timeOfDay}`;
  }
  return `每天 ${automation.timeOfDay}`;
}

function automationLastRunLabel(automation: AutomationRecord, running: boolean): string {
  if (running) {
    return "运行中";
  }
  const status =
    automation.lastStatus === "completed"
      ? "已完成"
      : automation.lastStatus === "failed"
        ? "失败"
        : automation.lastStatus === "interrupted"
          ? "已中断"
          : "未运行";
  return automation.lastRunAt ? `${status} · ${relativeTime(automation.lastRunAt)}` : status;
}

function automationStatusClass(automation: AutomationRecord, running: boolean): string {
  if (running) {
    return "running";
  }
  if (!automation.enabled && automation.cadence !== "manual") {
    return "paused";
  }
  return automation.lastStatus === "failed" || automation.lastStatus === "interrupted"
    ? automation.lastStatus
    : "ready";
}

function formatDateTime(timestamp: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
  }).format(timestamp);
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
  const rootRef = useRef<HTMLDivElement>(null);
  const usage = contextWindowCardSummary(state.tokenUsage);

  useEffect(() => {
    if (!open) {
      return;
    }
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className={`context-window-control ${open ? "open" : ""}`} ref={rootRef}>
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
        <span aria-hidden="true">
          <UiIcon name="menu" />
        </span>
      </button>
      {open && (
        <section aria-label="环境信息" className="environment-popover">
          <header>
            <span>环境信息</span>
            <button aria-label="环境设置" type="button">
              <UiIcon name="settings" />
            </button>
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
        icon={<UiIcon name="diff" />}
        label="变更"
        value={diffCount}
      />
      <EnvironmentRow icon={<UiIcon name="laptop" />} label="本地" value={sandboxLabel(sandbox)} />
      <EnvironmentRow icon={<UiIcon name="branch" />} label="分支" value={branch} />
      <EnvironmentRow icon={<UiIcon name="commit" />} label="提交或推送" value={diffFiles > 0 ? "可审阅" : "等待变更"} />
      <EnvironmentRow icon={<UiIcon name="github" />} label="GitHub CLI" value="不可用" muted />
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
  icon: ReactNode;
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
                  {turn.user.images && turn.user.images.length > 0 && (
                    <div className="user-message-images">
                      {turn.user.images.map((image) => (
                        <a
                          className="user-message-image"
                          href={image.dataUrl}
                          key={image.id}
                          rel="noopener noreferrer"
                          target="_blank"
                          title={`${image.name} · ${formatFileSize(image.sizeBytes)}`}
                        >
                          <img alt={image.name} src={image.dataUrl} />
                        </a>
                      ))}
                    </div>
                  )}
                  {turn.user.content && <p>{turn.user.content}</p>}
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

function BranchPicker({
  currentProject,
  disabled,
  onLoadBranches,
  onSwitchBranch,
}: {
  currentProject: ProjectSummary | null;
  disabled: boolean;
  onLoadBranches: ((projectId: string) => Promise<string[]>) | undefined;
  onSwitchBranch: ((projectId: string, branch: string) => void | Promise<void>) | undefined;
}) {
  const [branches, setBranches] = useState<string[]>([]);
  const currentBranch = currentProject?.git.branch ?? null;
  const isRepository = currentProject?.git.isRepository ?? false;
  const projectId = currentProject?.id ?? null;
  const interactive = Boolean(
    onLoadBranches && onSwitchBranch && currentProject?.available && isRepository && currentBranch,
  );

  useEffect(() => {
    if (!interactive || !projectId || !onLoadBranches) {
      setBranches([]);
      return;
    }
    let cancelled = false;
    void onLoadBranches(projectId).then((next) => {
      if (!cancelled) {
        setBranches(next);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [currentBranch, interactive, onLoadBranches, projectId]);

  if (!interactive || !currentBranch || !currentProject) {
    return (
      <span className="meta-chip">
        {currentProject?.git.branch ?? currentProject?.git.head ?? "无 Git 分支"}
      </span>
    );
  }

  const branchList = Array.from(new Set([currentBranch, ...branches]));
  const options = branchList.map((branch) => ({ label: branch, value: branch }));

  return (
    <PopupSelect
      ariaLabel="切换分支"
      className="project-meta-select branch-meta-select"
      disabled={disabled}
      label={<UiIcon name="branch" />}
      options={options}
      placement="top"
      value={currentBranch}
      onChange={(next) => {
        if (next !== currentBranch && onSwitchBranch) {
          void onSwitchBranch(currentProject.id, next);
        }
      }}
    />
  );
}

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
        <span aria-hidden="true">
          <UiIcon name="folder" />
        </span>
        未选择项目
      </button>
    );
  }

  return (
    <PopupSelect
      ariaLabel="切换项目"
      className="project-meta-select"
      disabled={disabled}
      label={<UiIcon name="folder" />}
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
