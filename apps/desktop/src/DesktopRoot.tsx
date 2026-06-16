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

type ManagedSession = {
  disposed: boolean;
  flushTimer: ReturnType<typeof setTimeout> | null;
  pendingEvents: Parameters<ThreadService["appendRuntimeEvents"]>[0];
  persistTimer: ReturnType<typeof setTimeout> | null;
  previousTurnStatus: SessionState["turnStatus"];
  session: DesktopSessionController;
  unsubscribeEvents: () => void;
  unsubscribeState: () => void;
  writeQueue: Promise<void>;
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
  const activityThreadIdRef = useRef<string | null>(null);
  const managedSessionsRef = useRef(new Map<DesktopSessionController, ManagedSession>());
  const projectRefreshInFlight = useRef(false);
  const projectStateRef = useRef<ProjectState | null>(null);
  const selectedSessionRef = useRef<DesktopSessionController | null>(null);
  const sessionByThreadIdRef = useRef(new Map<string, DesktopSessionController>());
  const threadStateRef = useRef<ThreadState | null>(null);

  useEffect(() => {
    projectStateRef.current = projectState;
  }, [projectState]);

  useEffect(() => {
    threadStateRef.current = threadState;
  }, [threadState]);

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

  const syncSelectedActivity = useCallback((force = false) => {
    const threadId = selectedSessionRef.current?.getSnapshot().threadId ?? null;
    if (!force && threadId === activityThreadIdRef.current) {
      return;
    }
    activityThreadIdRef.current = threadId;
    setActivityError(null);
    if (!threadId) {
      setActivityEvents([]);
      return;
    }
    setActivityEvents([]);
    void threadService
      .listActivity(threadId)
      .then((events) => {
        if (activityThreadIdRef.current === threadId) {
          setActivityEvents((current) => mergeActivityEvents(current, events));
        }
      })
      .catch((error) => {
        if (activityThreadIdRef.current === threadId) {
          setActivityError(errorMessage(error));
        }
      });
  }, [threadService]);

  const refreshProjectForSession = useCallback(async (state: SessionState) => {
    const projectId = projectStateRef.current?.projects.find((project) =>
      sameProjectPath(project.path, state.projectPath),
    )?.id;
    if (!projectId || projectRefreshInFlight.current) {
      return;
    }
    projectRefreshInFlight.current = true;
    try {
      const nextState = await projectService.refresh(projectId);
      setProjectState((current) => stabilizeProjectState(current, nextState));
    } catch {
      // 后台刷新失败不打断用户正在看的线程。
    } finally {
      projectRefreshInFlight.current = false;
    }
  }, [projectService]);

  const attachSession = useCallback((nextSession: DesktopSessionController) => {
    const existing = managedSessionsRef.current.get(nextSession);
    if (existing) {
      return nextSession;
    }

    const managed: ManagedSession = {
      disposed: false,
      flushTimer: null,
      pendingEvents: [],
      persistTimer: null,
      previousTurnStatus: nextSession.getSnapshot().turnStatus,
      session: nextSession,
      unsubscribeEvents: () => undefined,
      unsubscribeState: () => undefined,
      writeQueue: Promise.resolve(),
    };

    const flushRuntimeEvents = () => {
      if (managed.flushTimer) {
        clearTimeout(managed.flushTimer);
        managed.flushTimer = null;
      }
      if (managed.pendingEvents.length === 0) {
        return;
      }
      const events = managed.pendingEvents;
      managed.pendingEvents = [];
      managed.writeQueue = managed.writeQueue
        .then(() => threadService.appendRuntimeEvents(events))
        .catch((error) => {
          if (!managed.disposed) {
            setThreadError(errorMessage(error));
          }
        });
    };

    const persistSnapshot = (markUnread: boolean) => {
      const state = nextSession.getSnapshot();
      const project = projectStateRef.current?.projects.find((candidate) =>
        sameProjectPath(candidate.path, state.projectPath),
      );
      if (!state.threadId || !project) {
        return;
      }
      const existingThread = threadStateRef.current?.threads.find(
        (thread) => thread.id === state.threadId,
      );
      const selected = selectedSessionRef.current === nextSession;
      const unread = selected ? false : markUnread ? true : existingThread?.unread ?? false;
      void threadService
        .upsert(threadRecordFromSession(state, project.id, { existingThread, unread }), {
          select: selected,
        })
        .then((nextState) => {
          if (!managed.disposed) {
            setThreadState((current) => stabilizeThreadState(current, nextState));
            setThreadError(null);
          }
        })
        .catch((error) => {
          if (!managed.disposed) {
            setThreadError(errorMessage(error));
          }
        });
    };

    const schedulePersist = (markUnread = false) => {
      if (managed.persistTimer) {
        clearTimeout(managed.persistTimer);
        managed.persistTimer = null;
      }
      if (nextSession.getSnapshot().turnStatus !== "inProgress") {
        persistSnapshot(markUnread);
        return;
      }
      managed.persistTimer = setTimeout(() => persistSnapshot(markUnread), 1_000);
    };

    managed.unsubscribeState = nextSession.subscribe(() => {
      const state = nextSession.getSnapshot();
      if (state.threadId) {
        sessionByThreadIdRef.current.set(state.threadId, nextSession);
      }
      if (selectedSessionRef.current === nextSession) {
        syncSelectedActivity();
      }
      const justFinished =
        managed.previousTurnStatus === "inProgress" && state.turnStatus !== "inProgress";
      if (justFinished) {
        void refreshProjectForSession(state);
      }
      schedulePersist(justFinished && selectedSessionRef.current !== nextSession);
      managed.previousTurnStatus = state.turnStatus;
    });

    managed.unsubscribeEvents = nextSession.subscribeRuntimeEvents((event) => {
      managed.pendingEvents.push(event);
      if (selectedSessionRef.current === nextSession && nextSession.getSnapshot().threadId === event.threadId) {
        setActivityEvents((current) =>
          mergeActivityEvents(current, [{ ...event, occurredAt: Date.now() }]),
        );
      }
      if (managed.pendingEvents.length >= 100) {
        flushRuntimeEvents();
      } else if (!managed.flushTimer) {
        managed.flushTimer = setTimeout(flushRuntimeEvents, 100);
      }
    });

    managedSessionsRef.current.set(nextSession, managed);
    void nextSession.connect().catch((error) => setThreadError(errorMessage(error)));
    schedulePersist();
    return nextSession;
  }, [refreshProjectForSession, syncSelectedActivity, threadService]);

  const selectSession = useCallback((nextSession: DesktopSessionController) => {
    selectedSessionRef.current = nextSession;
    setSession(nextSession);
    syncSelectedActivity(true);
  }, [syncSelectedActivity]);

  const createManagedSession = useCallback(() => {
    return attachSession(createSession());
  }, [attachSession, createSession]);

  useEffect(() => {
    if (!credentialStatus?.configured || !settings) {
      return;
    }
    for (const managed of managedSessionsRef.current.values()) {
      disposeManagedSession(managed);
    }
    managedSessionsRef.current.clear();
    sessionByThreadIdRef.current.clear();
    activityThreadIdRef.current = null;
    const nextSession = createManagedSession();
    selectSession(nextSession);
    return () => {
      setSession(null);
      selectedSessionRef.current = null;
      for (const managed of managedSessionsRef.current.values()) {
        disposeManagedSession(managed);
      }
      managedSessionsRef.current.clear();
      sessionByThreadIdRef.current.clear();
    };
  }, [createManagedSession, credentialStatus?.configured, selectSession, settings]);

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

  const selectDraftSession = (projectPath: string | null) => {
    const nextSession = createManagedSession();
    nextSession.newThread(projectPath);
    selectSession(nextSession);
    return nextSession;
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
        selectDraftSession(project?.path ?? null);
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
    const project = projectState?.projects.find((candidate) => candidate.id === projectId) ?? null;
    if (!project) {
      return;
    }
    const previousProject =
      projectState?.projects.find((candidate) => candidate.id === projectState.selectedProjectId) ??
      null;
    setProjectBusy(true);
    setProjectError(null);
    setProjectState((current) => current ? { ...current, selectedProjectId: projectId } : current);
    const previousSession = session;
    selectDraftSession(project.path);
    setThreadState((current) => current ? { ...current, selectedThreadId: null } : current);
    try {
      const [nextState, nextThreadState] = await Promise.all([
        projectService.select(projectId),
        threadService.select(null),
      ]);
      setProjectState((current) => stabilizeProjectState(current, nextState));
      setThreadState((current) => stabilizeThreadState(current, nextThreadState));
    } catch (error) {
      setProjectState((current) =>
        current ? { ...current, selectedProjectId: previousProject?.id ?? null } : current,
      );
      if (previousSession) {
        selectSession(previousSession);
      } else {
        selectDraftSession(previousProject?.path ?? null);
      }
      setProjectError(errorMessage(error));
    } finally {
      setProjectBusy(false);
    }
  };

  const newThread = async () => {
    setThreadBusy(true);
    setThreadError(null);
    try {
      const project =
        projectState?.projects.find((candidate) => candidate.id === projectState.selectedProjectId) ??
        null;
      selectDraftSession(project?.path ?? null);
      const nextState = await threadService.select(null);
      setThreadState((current) => stabilizeThreadState(current, nextState));
    } catch (error) {
      setThreadError(errorMessage(error));
    } finally {
      setThreadBusy(false);
    }
  };

  const selectThread = async (threadId: string) => {
    if (!threadState) {
      return;
    }
    const thread = threadState.threads.find((candidate) => candidate.id === threadId);
    if (!thread || thread.projectId !== projectState?.selectedProjectId) {
      return;
    }
    setThreadBusy(true);
    setThreadError(null);
    try {
      const existingSession = sessionByThreadIdRef.current.get(thread.id);
      const nextSession = existingSession ?? createManagedSession();
      if (!existingSession) {
        const resume = nextSession.resumeThread({
          threadId: thread.id,
          projectPath: thread.projectPath,
          model: thread.model,
          sandbox: thread.sandbox,
          turnStatus: thread.turnStatus,
          timeline: thread.timeline,
          diff: thread.diff,
        });
        void resume.catch((error) => setThreadError(errorMessage(error)));
      }
      selectSession(nextSession);
      const nextState = await threadService.upsert({ ...thread, unread: false }, { select: true });
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
      const archiveSession =
        session.getSnapshot().turnStatus === "inProgress" ? createManagedSession() : session;
      await archiveSession.connect();
      await archiveSession.setThreadArchived(threadId, archived);
      if (session.getSnapshot().threadId === threadId) {
        const project =
          projectState?.projects.find(
            (candidate) => candidate.id === projectState.selectedProjectId,
          ) ?? null;
        selectDraftSession(project?.path ?? null);
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
        selectDraftSession(project?.path ?? null);
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
      if (
        document.visibilityState === "visible" &&
        session.getSnapshot().turnStatus !== "inProgress"
      ) {
        void refreshSelectedProject(true);
      }
    };
    const timer = window.setInterval(refreshWhenIdle, 30_000);
    return () => {
      unsubscribe();
      window.clearInterval(timer);
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

function disposeManagedSession(managed: ManagedSession): void {
  if (managed.disposed) {
    return;
  }
  managed.disposed = true;
  managed.unsubscribeState();
  managed.unsubscribeEvents();
  if (managed.persistTimer) {
    clearTimeout(managed.persistTimer);
  }
  if (managed.flushTimer) {
    clearTimeout(managed.flushTimer);
  }
  managed.pendingEvents = [];
  void managed.session.close();
}

function threadRecordFromSession(
  state: SessionState,
  projectId: string,
  options: { existingThread: ThreadRecord | undefined; unread: boolean },
): ThreadRecord {
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
    createdAt: options.existingThread?.createdAt ?? now,
    updatedAt: now,
    archived: options.existingThread?.archived ?? false,
    unread: options.unread,
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
