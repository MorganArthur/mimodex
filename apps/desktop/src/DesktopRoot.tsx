import { useEffect, useState, type FormEvent } from "react";

import type { DesktopSessionController, SessionState } from "@mimodex/desktop-core";
import { App } from "./App.js";
import type { CredentialService, CredentialStatus } from "./credentials.js";
import type { ProjectService, ProjectState } from "./projects.js";
import type { ThreadRecord, ThreadService, ThreadState } from "./threads.js";

export type DesktopRootProps = {
  credentialService: CredentialService;
  createSession: () => DesktopSessionController;
  projectService: ProjectService;
  threadService: ThreadService;
};

export function DesktopRoot({
  credentialService,
  createSession,
  projectService,
  threadService,
}: DesktopRootProps) {
  const [credentialStatus, setCredentialStatus] = useState<CredentialStatus | null>(null);
  const [credentialError, setCredentialError] = useState<string | null>(null);
  const [session, setSession] = useState<DesktopSessionController | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [projectState, setProjectState] = useState<ProjectState | null>(null);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [projectBusy, setProjectBusy] = useState(false);
  const [threadState, setThreadState] = useState<ThreadState | null>(null);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [threadBusy, setThreadBusy] = useState(false);

  useEffect(() => {
    void credentialService
      .getStatus()
      .then(setCredentialStatus)
      .catch((error) => setCredentialError(errorMessage(error)));
  }, [credentialService]);

  useEffect(() => {
    if (!credentialStatus?.configured) {
      return;
    }
    const nextSession = createSession();
    setSession(nextSession);
    return () => {
      setSession(null);
      void nextSession.close();
    };
  }, [createSession, credentialStatus?.configured]);

  useEffect(() => {
    if (!credentialStatus?.configured) {
      return;
    }
    void projectService
      .list()
      .then(setProjectState)
      .catch((error) => setProjectError(errorMessage(error)));
  }, [credentialStatus?.configured, projectService]);

  useEffect(() => {
    if (!credentialStatus?.configured) {
      return;
    }
    void threadService
      .list()
      .then(setThreadState)
      .catch((error) => setThreadError(errorMessage(error)));
  }, [credentialStatus?.configured, threadService]);

  useEffect(() => {
    if (!session || !projectState) {
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    const persistSnapshot = () => {
      const state = session.getSnapshot();
      const project = projectState.projects.find((candidate) =>
        sameProjectPath(candidate.path, state.projectPath),
      );
      if (!state.threadId || !project) {
        return;
      }
      void threadService
        .upsert(threadRecordFromSession(state, project.id))
        .then((nextState) => {
          if (!disposed) {
            setThreadState(nextState);
            setThreadError(null);
          }
        })
        .catch((error) => {
          if (!disposed) {
            setThreadError(errorMessage(error));
          }
        });
    };
    const persist = () => {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      if (session.getSnapshot().turnStatus !== "inProgress") {
        persistSnapshot();
        return;
      }
      timer = setTimeout(persistSnapshot, 1_000);
    };
    const unsubscribe = session.subscribe(persist);
    persist();
    return () => {
      disposed = true;
      unsubscribe();
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [projectState, session, threadService]);

  useEffect(() => {
    if (!session) {
      return;
    }
    let disposed = false;
    let writeQueue = Promise.resolve();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending: Parameters<ThreadService["appendRuntimeEvents"]>[0] = [];
    const flush = () => {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      if (pending.length === 0) {
        return;
      }
      const events = pending;
      pending = [];
      writeQueue = writeQueue
        .then(() => threadService.appendRuntimeEvents(events))
        .catch((error) => {
          if (!disposed) {
            setThreadError(errorMessage(error));
          }
        });
    };
    const unsubscribe = session.subscribeRuntimeEvents((event) => {
      pending.push(event);
      if (pending.length >= 100) {
        flush();
      } else if (!timer) {
        timer = setTimeout(flush, 100);
      }
    });
    return () => {
      unsubscribe();
      flush();
      disposed = true;
    };
  }, [session, threadService]);

  const saveCredential = async (apiKey: string) => {
    const status = await credentialService.save(apiKey);
    await credentialService.restart();
    setCredentialStatus(status);
  };

  const deleteCredential = async () => {
    const status = await credentialService.delete();
    await credentialService.restart();
    setCredentialStatus(status);
  };

  const addProject = async () => {
    setProjectBusy(true);
    setProjectError(null);
    try {
      const path = await projectService.pickDirectory();
      if (path) {
        const nextState = await projectService.add(path);
        setProjectState(nextState);
        const project =
          nextState.projects.find((candidate) => candidate.id === nextState.selectedProjectId) ??
          null;
        session?.newThread(project?.path ?? null);
        setThreadState(await threadService.select(null));
      }
    } catch (error) {
      setProjectError(errorMessage(error));
    } finally {
      setProjectBusy(false);
    }
  };

  const selectProject = async (projectId: string) => {
    if (projectState?.selectedProjectId === projectId) {
      return;
    }
    setProjectBusy(true);
    setProjectError(null);
    try {
      const nextState = await projectService.select(projectId);
      setProjectState(nextState);
      const project = nextState.projects.find((candidate) => candidate.id === projectId) ?? null;
      session?.newThread(project?.path ?? null);
      setThreadState(await threadService.select(null));
    } catch (error) {
      setProjectError(errorMessage(error));
    } finally {
      setProjectBusy(false);
    }
  };

  const newThread = async () => {
    if (!session) {
      return;
    }
    setThreadBusy(true);
    setThreadError(null);
    try {
      const project =
        projectState?.projects.find((candidate) => candidate.id === projectState.selectedProjectId) ??
        null;
      session.newThread(project?.path ?? null);
      setThreadState(await threadService.select(null));
    } catch (error) {
      setThreadError(errorMessage(error));
    } finally {
      setThreadBusy(false);
    }
  };

  const selectThread = async (threadId: string) => {
    if (!session || !threadState) {
      return;
    }
    const thread = threadState.threads.find((candidate) => candidate.id === threadId);
    if (!thread || thread.projectId !== projectState?.selectedProjectId) {
      return;
    }
    setThreadBusy(true);
    setThreadError(null);
    try {
      await session.resumeThread({
        threadId: thread.id,
        projectPath: thread.projectPath,
        model: thread.model,
        sandbox: thread.sandbox,
        turnStatus: thread.turnStatus,
        timeline: thread.timeline,
        diff: thread.diff,
      });
      setThreadState(await threadService.select(threadId));
    } catch (error) {
      setThreadError(errorMessage(error));
    } finally {
      setThreadBusy(false);
    }
  };

  const setThreadArchived = async (threadId: string, archived: boolean) => {
    if (!session || !threadState) {
      return;
    }
    setThreadBusy(true);
    setThreadError(null);
    try {
      await session.setThreadArchived(threadId, archived);
      if (session.getSnapshot().threadId === threadId) {
        const project =
          projectState?.projects.find(
            (candidate) => candidate.id === projectState.selectedProjectId,
          ) ?? null;
        session.newThread(project?.path ?? null);
      }
      setThreadState(await threadService.setArchived(threadId, archived));
    } catch (error) {
      setThreadError(errorMessage(error));
    } finally {
      setThreadBusy(false);
    }
  };

  const deleteThread = async (threadId: string) => {
    if (!session || !threadState) {
      return;
    }
    setThreadBusy(true);
    setThreadError(null);
    try {
      if (session.getSnapshot().threadId === threadId) {
        const project =
          projectState?.projects.find(
            (candidate) => candidate.id === projectState.selectedProjectId,
          ) ?? null;
        session.newThread(project?.path ?? null);
      }
      setThreadState(await threadService.delete(threadId));
    } catch (error) {
      setThreadError(errorMessage(error));
    } finally {
      setThreadBusy(false);
    }
  };

  const refreshProject = async () => {
    if (!projectState?.selectedProjectId) {
      return;
    }
    setProjectBusy(true);
    setProjectError(null);
    try {
      setProjectState(await projectService.refresh(projectState.selectedProjectId));
    } catch (error) {
      setProjectError(errorMessage(error));
    } finally {
      setProjectBusy(false);
    }
  };

  if (credentialError) {
    return <CredentialErrorPanel message={credentialError} />;
  }
  if (!credentialStatus) {
    return <LoadingPanel />;
  }
  if (!credentialStatus.configured) {
    return <CredentialSetup status={credentialStatus} onSave={saveCredential} />;
  }
  if (!session || !projectState || !threadState) {
    return <LoadingPanel />;
  }

  const currentProject =
    projectState.projects.find((project) => project.id === projectState.selectedProjectId) ?? null;
  const projectThreads = currentProject
    ? threadState.threads.filter((thread) => thread.projectId === currentProject.id && !thread.archived)
    : [];
  const archivedThreads = currentProject
    ? threadState.threads.filter((thread) => thread.projectId === currentProject.id && thread.archived)
    : [];

  return (
    <>
      <App
        archivedThreads={archivedThreads}
        currentProject={currentProject}
        onAddProject={addProject}
        onDeleteThread={deleteThread}
        onNewThread={newThread}
        onOpenSettings={() => setSettingsOpen(true)}
        onRefreshProject={refreshProject}
        onSelectProject={selectProject}
        onSelectThread={selectThread}
        onSetThreadArchived={setThreadArchived}
        projectBusy={projectBusy}
        projectError={projectError}
        projects={projectState.projects}
        session={session}
        threadBusy={threadBusy}
        threadError={threadError}
        threads={projectThreads}
      />
      {settingsOpen && (
        <CredentialSettings
          status={credentialStatus}
          onClose={() => setSettingsOpen(false)}
          onDelete={deleteCredential}
          onSave={saveCredential}
        />
      )}
    </>
  );
}

function threadRecordFromSession(state: SessionState, projectId: string): ThreadRecord {
  const now = Date.now();
  const firstUserMessage = state.timeline.find((entry) => entry.kind === "user")?.content.trim();
  return {
    id: state.threadId ?? "",
    projectId,
    projectPath: state.projectPath ?? "",
    title: compactTitle(firstUserMessage || "未命名线程"),
    model: state.model === "mimo-v2.5-pro" ? "mimo-v2.5-pro" : "mimo-v2.5",
    sandbox: state.sandbox,
    turnStatus: state.turnStatus,
    timeline: state.timeline.slice(-500).map((entry) => ({
      ...entry,
      content: entry.content.slice(-30_000),
    })),
    diff: state.diff.slice(-100_000),
    createdAt: now,
    updatedAt: now,
    archived: false,
  };
}

function compactTitle(value: string): string {
  return value.replace(/\s+/g, " ").slice(0, 60);
}

function sameProjectPath(left: string, right: string | null): boolean {
  return right !== null && left.toLocaleLowerCase() === right.toLocaleLowerCase();
}

function CredentialSetup({
  status,
  onSave,
}: {
  status: CredentialStatus;
  onSave: (apiKey: string) => Promise<void>;
}) {
  return (
    <main className="setup-screen">
      <section className="setup-card">
        <div className="setup-brand">
          <span className="brand-mark">M</span>
          <div><strong>Mimodex</strong><span>首次设置</span></div>
        </div>
        <p className="eyebrow">MIMO PROVIDER</p>
        <h1>连接你的 MiMo API</h1>
        <p className="setup-description">
          API Key 将保存在 Windows 凭据管理器中，不会写入项目、日志或普通配置文件。
        </p>
        <CredentialForm status={status} submitLabel="保存并重启 Mimodex" onSave={onSave} />
      </section>
    </main>
  );
}

function CredentialSettings({
  status,
  onClose,
  onDelete,
  onSave,
}: {
  status: CredentialStatus;
  onClose: () => void;
  onDelete: () => Promise<void>;
  onSave: (apiKey: string) => Promise<void>;
}) {
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const remove = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await onDelete();
    } catch (error) {
      setDeleteError(errorMessage(error));
      setDeleting(false);
    }
  };

  return (
    <div className="settings-backdrop" role="presentation">
      <section aria-label="MiMo 设置" aria-modal="true" className="settings-dialog" role="dialog">
        <header>
          <div><p className="eyebrow">设置</p><h2>MiMo Provider</h2></div>
          <button aria-label="关闭设置" type="button" onClick={onClose}>×</button>
        </header>
        <CredentialForm status={status} submitLabel="更换 Key 并重启" onSave={onSave} />
        {status.source === "windowsCredentialManager" ? (
          <div className="danger-zone">
            <div>
              <strong>删除已保存的 API Key</strong>
              <span>删除后 Mimodex 将重启，并返回首次设置界面。</span>
            </div>
            <button disabled={deleting} type="button" onClick={() => void remove()}>
              {deleting ? "删除中" : "删除凭据"}
            </button>
          </div>
        ) : (
          <div className="environment-note">
            当前凭据来自启动环境变量。保存新的 Key 可将其迁移到 Windows 凭据管理器；
            环境变量本身需要在系统环境设置中移除。
          </div>
        )}
        {deleteError && <p className="form-error">{deleteError}</p>}
      </section>
    </div>
  );
}

function CredentialForm({
  status,
  submitLabel,
  onSave,
}: {
  status: CredentialStatus;
  submitLabel: string;
  onSave: (apiKey: string) => Promise<void>;
}) {
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!apiKey.trim() || saving) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(apiKey);
    } catch (saveError) {
      setError(errorMessage(saveError));
      setSaving(false);
    }
  };

  return (
    <form className="credential-form" onSubmit={(event) => void submit(event)}>
      <label>
        <span>API Base URL</span>
        <input disabled value="https://api.xiaomimimo.com/v1" />
        <small>首版使用官方端点；自定义兼容端点将在连接诊断阶段开放。</small>
      </label>
      <label>
        <span>MiMo API Key</span>
        <input
          aria-label="MiMo API Key"
          autoComplete="off"
          placeholder={status.configured ? "输入新的 Key 以替换现有凭据" : "输入你的 MiMo API Key"}
          type="password"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
        />
      </label>
      <div className="credential-status">
        <span className={`connection-dot ${status.configured ? "ready" : "idle"}`} />
        <div>
          <strong>{credentialStatusLabel(status)}</strong>
          <span>安全存储：{status.storage}</span>
        </div>
      </div>
      {error && <p className="form-error">{error}</p>}
      <button className="credential-submit" disabled={!apiKey.trim() || saving} type="submit">
        {saving ? "正在安全保存…" : submitLabel}
      </button>
      <p className="restart-note">保存后应用会重启一次，Runtime 才能安全读取新凭据。</p>
    </form>
  );
}

function LoadingPanel() {
  return <main className="setup-screen"><div className="loading-panel">正在准备 Mimodex…</div></main>;
}

function CredentialErrorPanel({ message }: { message: string }) {
  return (
    <main className="setup-screen">
      <section className="setup-card">
        <p className="eyebrow">凭据存储异常</p>
        <h1>无法读取 Windows 凭据管理器</h1>
        <p className="setup-description">{message}</p>
      </section>
    </main>
  );
}

function credentialStatusLabel(status: CredentialStatus): string {
  if (status.source === "windowsCredentialManager") {
    return "已安全保存";
  }
  if (status.source === "environment") {
    return "当前使用环境变量";
  }
  return "尚未配置";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
