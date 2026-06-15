import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import type { DesktopSessionController, SessionState } from "@mimodex/desktop-core";
import { App } from "./App.js";
import { ConfirmationDialog } from "./ConfirmationDialog.js";
import type { CredentialService, CredentialStatus } from "./credentials.js";
import { MIMO_MODEL_OPTIONS, PopupSelect, SANDBOX_OPTIONS } from "./PopupSelect.js";
import type { ProjectService, ProjectState } from "./projects.js";
import {
  type AppSettings,
  type ConnectionDiagnostic,
  type SettingsService,
} from "./settings.js";
import type {
  ThreadActivityEvent,
  ThreadRecord,
  ThreadService,
  ThreadState,
} from "./threads.js";

export type DesktopRootProps = {
  credentialService: CredentialService;
  createSession: () => DesktopSessionController;
  projectService: ProjectService;
  settingsService: SettingsService;
  threadService: ThreadService;
};

export function DesktopRoot({
  credentialService,
  createSession,
  projectService,
  settingsService,
  threadService,
}: DesktopRootProps) {
  const [credentialStatus, setCredentialStatus] = useState<CredentialStatus | null>(null);
  const [credentialError, setCredentialError] = useState<string | null>(null);
  const [session, setSession] = useState<DesktopSessionController | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [projectState, setProjectState] = useState<ProjectState | null>(null);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [projectBusy, setProjectBusy] = useState(false);
  const [threadState, setThreadState] = useState<ThreadState | null>(null);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [threadBusy, setThreadBusy] = useState(false);
  const [activityEvents, setActivityEvents] = useState<ThreadActivityEvent[]>([]);
  const [activityError, setActivityError] = useState<string | null>(null);
  const projectRefreshInFlight = useRef(false);

  useEffect(() => {
    void settingsService
      .get()
      .then(setSettings)
      .catch((error) => setSettingsError(errorMessage(error)));
  }, [settingsService]);

  useEffect(() => {
    void credentialService
      .getStatus()
      .then(setCredentialStatus)
      .catch((error) => setCredentialError(errorMessage(error)));
  }, [credentialService]);

  useEffect(() => {
    if (!credentialStatus?.configured || !settings) {
      return;
    }
    const nextSession = createSession();
    setSession(nextSession);
    return () => {
      setSession(null);
      void nextSession.close();
    };
  }, [createSession, credentialStatus?.configured, settings]);

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
            setThreadState((current) => stabilizeThreadState(current, nextState));
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
    let activeThreadId: string | null = null;
    const syncActivity = () => {
      const threadId = session.getSnapshot().threadId;
      if (threadId === activeThreadId) {
        return;
      }
      activeThreadId = threadId;
      setActivityError(null);
      if (!threadId) {
        setActivityEvents([]);
        return;
      }
      setActivityEvents([]);
      void threadService
        .listActivity(threadId)
        .then((events) => {
          if (!disposed && activeThreadId === threadId) {
            setActivityEvents((current) => mergeActivityEvents(current, events));
          }
        })
        .catch((error) => {
          if (!disposed && activeThreadId === threadId) {
            setActivityError(errorMessage(error));
          }
        });
    };
    const unsubscribe = session.subscribe(syncActivity);
    syncActivity();
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [session, threadService]);

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
      if (session.getSnapshot().threadId === event.threadId) {
        setActivityEvents((current) =>
          mergeActivityEvents(current, [{ ...event, occurredAt: Date.now() }]),
        );
      }
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

  const saveCredential = async (apiKey: string, nextSettings?: AppSettings) => {
    const diagnostic = await settingsService.diagnose({
      apiKey,
      settings: nextSettings ?? settings!,
    });
    assertDiagnosticSucceeded(diagnostic);
    if (nextSettings) {
      setSettings(await settingsService.save(nextSettings));
    }
    const status = await credentialService.save(apiKey);
    await credentialService.restart();
    setCredentialStatus(status);
  };

  const deleteCredential = async () => {
    const status = await credentialService.delete();
    await credentialService.restart();
    setCredentialStatus(status);
  };

  const saveSettings = async (nextSettings: AppSettings) => {
    setSettingsError(null);
    assertDiagnosticSucceeded(await settingsService.diagnose({ settings: nextSettings }));
    const saved = await settingsService.save(nextSettings);
    setSettings(saved);
    await credentialService.restart();
  };

  const addProject = async () => {
    setProjectBusy(true);
    setProjectError(null);
    try {
      const path = await projectService.pickDirectory();
      if (path) {
        const nextState = await projectService.add(path);
        setProjectState((current) => stabilizeProjectState(current, nextState));
        const project =
          nextState.projects.find((candidate) => candidate.id === nextState.selectedProjectId) ??
          null;
        session?.newThread(project?.path ?? null);
        const nextThreadState = await threadService.select(null);
        setThreadState((current) => stabilizeThreadState(current, nextThreadState));
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
      setProjectState((current) => stabilizeProjectState(current, nextState));
      const project = nextState.projects.find((candidate) => candidate.id === projectId) ?? null;
      session?.newThread(project?.path ?? null);
      const nextThreadState = await threadService.select(null);
      setThreadState((current) => stabilizeThreadState(current, nextThreadState));
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
      const nextState = await threadService.select(null);
      setThreadState((current) => stabilizeThreadState(current, nextState));
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
      const nextState = await threadService.select(threadId);
      setThreadState((current) => stabilizeThreadState(current, nextState));
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
      const nextState = await threadService.setArchived(threadId, archived);
      setThreadState((current) => stabilizeThreadState(current, nextState));
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
      const nextState = await threadService.delete(threadId);
      setThreadState((current) => stabilizeThreadState(current, nextState));
    } catch (error) {
      setThreadError(errorMessage(error));
    } finally {
      setThreadBusy(false);
    }
  };

  const refreshSelectedProject = useCallback(async (quiet = false) => {
    const projectId = projectState?.selectedProjectId;
    if (!projectId || projectRefreshInFlight.current) {
      return;
    }
    projectRefreshInFlight.current = true;
    if (!quiet) {
      setProjectBusy(true);
      setProjectError(null);
    }
    try {
      const nextState = await projectService.refresh(projectId);
      setProjectState((current) => stabilizeProjectState(current, nextState));
    } catch (error) {
      if (!quiet) {
        setProjectError(errorMessage(error));
      }
    } finally {
      projectRefreshInFlight.current = false;
      if (!quiet) {
        setProjectBusy(false);
      }
    }
  }, [projectService, projectState?.selectedProjectId]);

  useEffect(() => {
    if (!session || !projectState?.selectedProjectId) {
      return;
    }
    let previous = session.getSnapshot().turnStatus;
    const unsubscribe = session.subscribe(() => {
      const current = session.getSnapshot().turnStatus;
      if (previous === "inProgress" && current !== "inProgress") {
        void refreshSelectedProject(true);
      }
      previous = current;
    });
    const refreshWhenIdle = () => {
      if (session.getSnapshot().turnStatus !== "inProgress") {
        void refreshSelectedProject(true);
      }
    };
    const timer = window.setInterval(refreshWhenIdle, 10_000);
    window.addEventListener("focus", refreshWhenIdle);
    return () => {
      unsubscribe();
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshWhenIdle);
    };
  }, [projectState?.selectedProjectId, refreshSelectedProject, session]);

  const refreshProject = () => refreshSelectedProject(false);

  if (credentialError || (settingsError && !settings)) {
    return <CredentialErrorPanel message={credentialError ?? settingsError ?? "无法读取设置。"} />;
  }
  if (!credentialStatus || !settings) {
    return <LoadingPanel />;
  }
  if (!credentialStatus.configured) {
    return <CredentialSetup settings={settings} status={credentialStatus} onSave={saveCredential} />;
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
        activityError={activityError}
        activityEvents={activityEvents}
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
        settings={settings}
        threadBusy={threadBusy}
        threadError={threadError}
        threads={projectThreads}
      />
      {settingsOpen && (
        <CredentialSettings
          status={credentialStatus}
          settings={settings}
          onClose={() => setSettingsOpen(false)}
          onDelete={deleteCredential}
          onDiagnose={(diagnosticSettings, apiKey) =>
            settingsService.diagnose({
              settings: diagnosticSettings,
              ...(apiKey ? { apiKey } : {}),
            })
          }
          onSave={saveCredential}
          onSaveSettings={saveSettings}
        />
      )}
      {settingsError && <div className="global-error">{settingsError}</div>}
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

function stabilizeProjectState(
  current: ProjectState | null,
  next: ProjectState,
): ProjectState {
  return {
    ...next,
    projects: stabilizeItemOrder(current?.projects, next.projects),
  };
}

function stabilizeThreadState(current: ThreadState | null, next: ThreadState): ThreadState {
  return {
    ...next,
    threads: stabilizeItemOrder(current?.threads, next.threads),
  };
}

function stabilizeItemOrder<T extends { id: string }>(current: T[] | undefined, next: T[]): T[] {
  if (!current) {
    return next;
  }
  const currentIds = new Set(current.map((item) => item.id));
  const nextById = new Map(next.map((item) => [item.id, item]));
  const newItems = next.filter((item) => !currentIds.has(item.id));
  const existingItems = current.flatMap((item) => {
    const updated = nextById.get(item.id);
    return updated ? [updated] : [];
  });
  return [...newItems, ...existingItems];
}

function CredentialSetup({
  settings,
  status,
  onSave,
}: {
  settings: AppSettings;
  status: CredentialStatus;
  onSave: (apiKey: string, settings?: AppSettings) => Promise<void>;
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
        <CredentialForm
          settings={settings}
          status={status}
          submitLabel="保存并重启 Mimodex"
          onSave={onSave}
        />
      </section>
    </main>
  );
}

function CredentialSettings({
  settings,
  status,
  onClose,
  onDelete,
  onDiagnose,
  onSave,
  onSaveSettings,
}: {
  settings: AppSettings;
  status: CredentialStatus;
  onClose: () => void;
  onDelete: () => Promise<void>;
  onDiagnose: (settings: AppSettings, apiKey?: string) => Promise<ConnectionDiagnostic>;
  onSave: (apiKey: string) => Promise<void>;
  onSaveSettings: (settings: AppSettings) => Promise<void>;
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
        <ProviderSettingsForm settings={settings} onDiagnose={onDiagnose} onSave={onSaveSettings} />
        <CredentialForm
          diagnosticSettings={settings}
          status={status}
          submitLabel="更换 Key 并重启"
          onDiagnose={onDiagnose}
          onSave={onSave}
        />
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
  diagnosticSettings,
  settings,
  status,
  submitLabel,
  onDiagnose,
  onSave,
}: {
  diagnosticSettings?: AppSettings;
  settings?: AppSettings;
  status: CredentialStatus;
  submitLabel: string;
  onDiagnose?: (settings: AppSettings, apiKey?: string) => Promise<ConnectionDiagnostic>;
  onSave: (apiKey: string, settings?: AppSettings) => Promise<void>;
}) {
  const [apiKey, setApiKey] = useState("");
  const [apiBaseUrl, setApiBaseUrl] = useState(settings?.apiBaseUrl ?? "");
  const [defaultModel, setDefaultModel] = useState(settings?.defaultModel ?? "mimo-v2.5");
  const [defaultSandbox, setDefaultSandbox] = useState(
    settings?.defaultSandbox ?? "workspace-write",
  );
  const [saving, setSaving] = useState(false);
  const [diagnosing, setDiagnosing] = useState(false);
  const [diagnostic, setDiagnostic] = useState<ConnectionDiagnostic | null>(null);
  const [error, setError] = useState<string | null>(null);
  const runDiagnostic = async () => {
    if (!onDiagnose || !diagnosticSettings || !apiKey.trim() || diagnosing) {
      return;
    }
    setDiagnosing(true);
    setDiagnostic(null);
    setError(null);
    try {
      setDiagnostic(await onDiagnose(diagnosticSettings, apiKey));
    } catch (diagnosticError) {
      setError(errorMessage(diagnosticError));
    } finally {
      setDiagnosing(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!apiKey.trim() || saving) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(
        apiKey,
        settings ? { apiBaseUrl, defaultModel, defaultSandbox } : undefined,
      );
    } catch (saveError) {
      setError(errorMessage(saveError));
      setSaving(false);
    }
  };

  return (
    <form className="credential-form" onSubmit={(event) => void submit(event)}>
      {settings && (
        <SettingsFields
          apiBaseUrl={apiBaseUrl}
          defaultModel={defaultModel}
          defaultSandbox={defaultSandbox}
          onApiBaseUrlChange={setApiBaseUrl}
          onDefaultModelChange={setDefaultModel}
          onDefaultSandboxChange={setDefaultSandbox}
        />
      )}
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
      <DiagnosticResult diagnostic={diagnostic} />
      {onDiagnose && diagnosticSettings && (
        <button
          className="credential-secondary"
          disabled={!apiKey.trim() || diagnosing || saving}
          type="button"
          onClick={() => void runDiagnostic()}
        >
          {diagnosing ? "正在测试连接…" : "验证新 Key"}
        </button>
      )}
      <button className="credential-submit" disabled={!apiKey.trim() || saving} type="submit">
        {saving ? "正在安全保存…" : submitLabel}
      </button>
      <p className="restart-note">保存后应用会重启一次，Runtime 才能安全读取新凭据。</p>
    </form>
  );
}

function ProviderSettingsForm({
  settings,
  onDiagnose,
  onSave,
}: {
  settings: AppSettings;
  onDiagnose: (settings: AppSettings) => Promise<ConnectionDiagnostic>;
  onSave: (settings: AppSettings) => Promise<void>;
}) {
  const [apiBaseUrl, setApiBaseUrl] = useState(settings.apiBaseUrl);
  const [defaultModel, setDefaultModel] = useState(settings.defaultModel);
  const [defaultSandbox, setDefaultSandbox] = useState(settings.defaultSandbox);
  const [saving, setSaving] = useState(false);
  const [diagnosing, setDiagnosing] = useState(false);
  const [diagnostic, setDiagnostic] = useState<ConnectionDiagnostic | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fullAccessWarningOpen, setFullAccessWarningOpen] = useState(false);
  useEffect(() => {
    setApiBaseUrl(settings.apiBaseUrl);
    setDefaultModel(settings.defaultModel);
    setDefaultSandbox(settings.defaultSandbox);
  }, [settings]);
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave({ apiBaseUrl, defaultModel, defaultSandbox });
      setSaving(false);
    } catch (saveError) {
      setError(errorMessage(saveError));
      setSaving(false);
    }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (defaultSandbox === "danger-full-access") {
      setFullAccessWarningOpen(true);
      return;
    }
    await save();
  };
  const diagnose = async () => {
    if (diagnosing) {
      return;
    }
    setDiagnosing(true);
    setDiagnostic(null);
    setError(null);
    try {
      setDiagnostic(await onDiagnose({ apiBaseUrl, defaultModel, defaultSandbox }));
    } catch (diagnosticError) {
      setError(errorMessage(diagnosticError));
    } finally {
      setDiagnosing(false);
    }
  };
  return (
    <>
      <form className="credential-form provider-settings-form" onSubmit={(event) => void submit(event)}>
        <SettingsFields
          apiBaseUrl={apiBaseUrl}
          defaultModel={defaultModel}
          defaultSandbox={defaultSandbox}
          onApiBaseUrlChange={setApiBaseUrl}
          onDefaultModelChange={setDefaultModel}
          onDefaultSandboxChange={setDefaultSandbox}
        />
        {error && <p className="form-error">{error}</p>}
        <DiagnosticResult diagnostic={diagnostic} />
        <button
          className="credential-secondary"
          disabled={diagnosing || saving}
          type="button"
          onClick={() => void diagnose()}
        >
          {diagnosing ? "正在测试连接…" : "测试端点与已保存 Key"}
        </button>
        <button className="credential-submit" disabled={saving} type="submit">
          {saving ? "正在保存…" : "保存默认设置并重启"}
        </button>
      </form>
      {fullAccessWarningOpen && (
        <ConfirmationDialog
          cancelLabel="返回设置"
          confirmLabel="设为默认完全访问"
          description="新线程将默认能够访问当前项目之外的文件并运行具有系统级副作用的命令。请只在明确需要时启用。"
          eyebrow="高风险默认设置"
          onCancel={() => setFullAccessWarningOpen(false)}
          onConfirm={() => {
            setFullAccessWarningOpen(false);
            void save();
          }}
          title="将完全访问设为默认权限？"
          tone="danger"
        />
      )}
    </>
  );
}

function DiagnosticResult({ diagnostic }: { diagnostic: ConnectionDiagnostic | null }) {
  if (!diagnostic) {
    return null;
  }
  return (
    <div className={`diagnostic-result ${diagnostic.ok ? "success" : "failure"}`} role="status">
      <strong>{diagnostic.message}</strong>
      <span>{diagnostic.detail}</span>
      <small>
        类别：{diagnostic.category}
        {diagnostic.statusCode ? ` · HTTP ${diagnostic.statusCode}` : ""}
        {diagnostic.latencyMs !== null ? ` · ${diagnostic.latencyMs} ms` : ""}
      </small>
    </div>
  );
}

function SettingsFields({
  apiBaseUrl,
  defaultModel,
  defaultSandbox,
  onApiBaseUrlChange,
  onDefaultModelChange,
  onDefaultSandboxChange,
}: {
  apiBaseUrl: string;
  defaultModel: AppSettings["defaultModel"];
  defaultSandbox: AppSettings["defaultSandbox"];
  onApiBaseUrlChange: (value: string) => void;
  onDefaultModelChange: (value: AppSettings["defaultModel"]) => void;
  onDefaultSandboxChange: (value: AppSettings["defaultSandbox"]) => void;
}) {
  return (
    <>
      <label>
        <span>API Base URL</span>
        <input
          aria-label="API Base URL"
          value={apiBaseUrl}
          onChange={(event) => onApiBaseUrlChange(event.target.value)}
        />
        <small>自定义端点会收到你的 API Key 与任务上下文，请仅使用可信服务。</small>
      </label>
      <div className="settings-field">
        <span>默认模型</span>
        <PopupSelect
          ariaLabel="默认模型"
          className="settings-popup-select"
          label="默认模型"
          options={MIMO_MODEL_OPTIONS}
          value={defaultModel}
          onChange={(next) => onDefaultModelChange(next as AppSettings["defaultModel"])}
        />
      </div>
      <div className="settings-field">
        <span>默认权限</span>
        <PopupSelect
          ariaLabel="默认权限"
          className="settings-popup-select"
          label="默认权限"
          options={SANDBOX_OPTIONS}
          value={defaultSandbox}
          onChange={(next) => onDefaultSandboxChange(next as AppSettings["defaultSandbox"])}
        />
        {defaultSandbox === "danger-full-access" && (
          <small className="danger-setting-note">
            完全访问允许 Agent 访问项目外内容并运行具有系统级副作用的命令。
          </small>
        )}
      </div>
    </>
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

function assertDiagnosticSucceeded(diagnostic: ConnectionDiagnostic): void {
  if (!diagnostic.ok) {
    throw new Error(`${diagnostic.message}：${diagnostic.detail}`);
  }
}

function mergeActivityEvents(
  ...groups: readonly ThreadActivityEvent[][]
): ThreadActivityEvent[] {
  const events = new Map<string, ThreadActivityEvent>();
  for (const event of groups.flat()) {
    events.set(event.eventId, event);
  }
  return [...events.values()]
    .sort((left, right) => right.occurredAt - left.occurredAt)
    .slice(0, 300);
}
