import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactNode,
} from "react";

import type { DesktopSessionController, SessionState, TokenUsage } from "@mimodex/desktop-core";
import { App } from "./App.js";
import {
  createAutomationService,
  nextAutomationRunAt,
  type AutomationDraft,
  type AutomationRecord,
  type AutomationService,
  type AutomationState,
} from "./automation.js";
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
import { APP_VERSION } from "./version.js";

export type DesktopRootProps = {
  automationService?: AutomationService;
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

type RunningAutomation = {
  automationId: string;
  startedAt: number;
};

type SettingsView = "dashboard" | "menu" | "model";

export function DesktopRoot({
  automationService: providedAutomationService,
  credentialService,
  createSession,
  projectService,
  settingsService,
  threadService,
}: DesktopRootProps) {
  const fallbackAutomationServiceRef = useRef<AutomationService | null>(null);
  if (!fallbackAutomationServiceRef.current) {
    fallbackAutomationServiceRef.current = createAutomationService();
  }
  const automationService = providedAutomationService ?? fallbackAutomationServiceRef.current;

  const [credentialStatus, setCredentialStatus] = useState<CredentialStatus | null>(null);
  const [credentialError, setCredentialError] = useState<string | null>(null);
  const [session, setSession] = useState<DesktopSessionController | null>(null);
  const [settingsView, setSettingsView] = useState<SettingsView | null>(null);
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
  const [automationState, setAutomationState] = useState<AutomationState | null>(null);
  const [automationError, setAutomationError] = useState<string | null>(null);
  const [automationBusy, setAutomationBusy] = useState(false);
  const [runningAutomationIds, setRunningAutomationIds] = useState<string[]>([]);
  const activityThreadIdRef = useRef<string | null>(null);
  const automationStateRef = useRef<AutomationState | null>(null);
  const managedSessionsRef = useRef(new Map<DesktopSessionController, ManagedSession>());
  const projectRefreshInFlight = useRef(false);
  const projectStateRef = useRef<ProjectState | null>(null);
  const runningAutomationsRef = useRef(new Map<DesktopSessionController, RunningAutomation>());
  const runningAutomationIdsRef = useRef(new Set<string>());
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
    automationStateRef.current = automationState;
  }, [automationState]);

  useEffect(() => {
    runningAutomationIdsRef.current = new Set(runningAutomationIds);
  }, [runningAutomationIds]);

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

  useEffect(() => {
    if (!credentialStatus?.configured) {
      return;
    }
    void automationService
      .list()
      .then(setAutomationState)
      .catch((error) => {
        setAutomationError(errorMessage(error));
        setAutomationState({ automations: [] });
      });
  }, [automationService, credentialStatus?.configured]);

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

  const completeAutomationRun = useCallback(async (
    completedSession: DesktopSessionController,
    state: SessionState,
  ) => {
    const running = runningAutomationsRef.current.get(completedSession);
    if (!running) {
      return;
    }
    runningAutomationsRef.current.delete(completedSession);
    runningAutomationIdsRef.current.delete(running.automationId);
    setRunningAutomationIds((current) =>
      current.filter((automationId) => automationId !== running.automationId),
    );

    const automation = automationStateRef.current?.automations.find(
      (candidate) => candidate.id === running.automationId,
    );
    const status =
      state.turnStatus === "completed"
        ? "completed"
        : state.turnStatus === "interrupted"
          ? "interrupted"
          : "failed";
    const completedAt = Date.now();
    const nextRunAt = automation?.enabled ? nextAutomationRunAt(automation, completedAt) : null;
    const error =
      status === "completed"
        ? null
        : state.error ?? state.structuredError?.message ?? "自动化任务未完成。";

    try {
      const nextState = await automationService.recordRun({
        automationId: running.automationId,
        completedAt,
        error,
        lastRunAt: running.startedAt,
        nextRunAt,
        status,
        threadId: state.threadId,
      });
      setAutomationState(nextState);
      setAutomationError(null);
    } catch (error) {
      setAutomationError(errorMessage(error));
    }
  }, [automationService]);

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
        void completeAutomationRun(nextSession, state);
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
  }, [completeAutomationRun, refreshProjectForSession, syncSelectedActivity, threadService]);

  const selectSession = useCallback((nextSession: DesktopSessionController) => {
    selectedSessionRef.current = nextSession;
    setSession(nextSession);
    syncSelectedActivity(true);
  }, [syncSelectedActivity]);

  const createManagedSession = useCallback(() => {
    return attachSession(createSession());
  }, [attachSession, createSession]);

  const createAutomation = async (draft: AutomationDraft) => {
    setAutomationBusy(true);
    setAutomationError(null);
    try {
      const nextState = await automationService.create(draft);
      setAutomationState(nextState);
    } catch (error) {
      setAutomationError(errorMessage(error));
    } finally {
      setAutomationBusy(false);
    }
  };

  const updateAutomation = async (automationId: string, draft: AutomationDraft) => {
    setAutomationBusy(true);
    setAutomationError(null);
    try {
      const nextState = await automationService.update(automationId, draft);
      setAutomationState(nextState);
    } catch (error) {
      setAutomationError(errorMessage(error));
    } finally {
      setAutomationBusy(false);
    }
  };

  const deleteAutomation = async (automationId: string) => {
    setAutomationBusy(true);
    setAutomationError(null);
    try {
      const nextState = await automationService.delete(automationId);
      setAutomationState(nextState);
    } catch (error) {
      setAutomationError(errorMessage(error));
    } finally {
      setAutomationBusy(false);
    }
  };

  const runAutomation = useCallback(async (automationId: string) => {
    if (runningAutomationIdsRef.current.has(automationId) || !settings) {
      return;
    }
    const automation = automationStateRef.current?.automations.find(
      (candidate) => candidate.id === automationId,
    );
    const project = projectStateRef.current?.projects.find(
      (candidate) => candidate.id === automation?.projectId,
    );
    if (!automation || !project) {
      setAutomationError("自动化任务或项目记录不存在。");
      return;
    }
    if (!project.available) {
      setAutomationError(`项目“${project.name}”当前不可访问，自动化未运行。`);
      return;
    }

    const startedAt = Date.now();
    runningAutomationIdsRef.current.add(automationId);
    setRunningAutomationIds((current) =>
      current.includes(automationId) ? current : [...current, automationId],
    );
    const automationSession = createManagedSession();
    runningAutomationsRef.current.set(automationSession, { automationId, startedAt });
    try {
      automationSession.newThread(project.path);
      await automationSession.connect();
      await automationSession.startTask({
        model: automation.model ?? settings.defaultModel,
        projectPath: project.path,
        sandbox: automation.sandbox ?? settings.defaultSandbox,
        text: automationTaskPrompt(automation, project.name),
      });
      const snapshot = automationSession.getSnapshot();
      const nextState = await automationService.recordRun({
        automationId,
        completedAt: null,
        error: null,
        lastRunAt: startedAt,
        nextRunAt: automation.nextRunAt,
        status: "running",
        threadId: snapshot.threadId,
      });
      setAutomationState(nextState);
      setAutomationError(null);
      if (snapshot.turnStatus !== "inProgress") {
        await completeAutomationRun(automationSession, snapshot);
      }
    } catch (error) {
      runningAutomationsRef.current.delete(automationSession);
      runningAutomationIdsRef.current.delete(automationId);
      setRunningAutomationIds((current) =>
        current.filter((candidate) => candidate !== automationId),
      );
      const completedAt = Date.now();
      const nextRunAt = automation.enabled ? nextAutomationRunAt(automation, completedAt) : null;
      try {
        const nextState = await automationService.recordRun({
          automationId,
          completedAt,
          error: errorMessage(error),
          lastRunAt: startedAt,
          nextRunAt,
          status: "failed",
          threadId: automationSession.getSnapshot().threadId,
        });
        setAutomationState(nextState);
      } catch (recordError) {
        setAutomationError(errorMessage(recordError));
      }
      setAutomationError(errorMessage(error));
    }
  }, [automationService, completeAutomationRun, createManagedSession, settings]);

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

  useEffect(() => {
    if (!credentialStatus?.configured || !automationState || !projectState || !settings) {
      return;
    }
    const runDueAutomations = () => {
      const now = Date.now();
      for (const automation of automationStateRef.current?.automations ?? []) {
        if (
          automation.enabled &&
          automation.nextRunAt !== null &&
          automation.nextRunAt <= now &&
          !runningAutomationIdsRef.current.has(automation.id)
        ) {
          void runAutomation(automation.id);
        }
      }
    };
    runDueAutomations();
    const timer = window.setInterval(runDueAutomations, 30_000);
    return () => window.clearInterval(timer);
  }, [
    automationState,
    credentialStatus?.configured,
    projectState,
    runAutomation,
    settings,
  ]);

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

  const openTerminal = async () => {
    const project =
      projectState?.projects.find((candidate) => candidate.id === projectState.selectedProjectId) ??
      null;
    if (!project?.available) {
      return;
    }
    setProjectError(null);
    try {
      await projectService.openTerminal(project.path);
    } catch (error) {
      setProjectError(errorMessage(error));
    }
  };

  if (credentialError || (settingsError && !settings)) {
    return <CredentialErrorPanel message={credentialError ?? settingsError ?? "无法读取设置。"} />;
  }
  if (!credentialStatus || !settings) {
    return <LoadingPanel />;
  }
  if (!credentialStatus.configured) {
    return <CredentialSetup settings={settings} status={credentialStatus} onSave={saveCredential} />;
  }
  if (!session || !projectState || !threadState || !automationState) {
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
        automationBusy={automationBusy}
        automationError={automationError}
        automations={automationState.automations}
        archivedThreads={archivedThreads}
        currentProject={currentProject}
        onCreateAutomation={createAutomation}
        onAddProject={addProject}
        onDeleteAutomation={deleteAutomation}
        onDeleteThread={deleteThread}
        onNewThread={newThread}
        onOpenSettings={() => setSettingsView("menu")}
        onOpenTerminal={openTerminal}
        onRefreshProject={refreshProject}
        onRunAutomation={runAutomation}
        onSelectProject={selectProject}
        onSelectThread={selectThread}
        onSetThreadArchived={setThreadArchived}
        onUpdateAutomation={updateAutomation}
        projectBusy={projectBusy}
        projectError={projectError}
        projects={projectState.projects}
        runningAutomationIds={runningAutomationIds}
        session={session}
        settings={settings}
        threadBusy={threadBusy}
        threadError={threadError}
        threads={projectThreads}
      />
      {settingsView && (
        <SettingsHub
          automations={automationState.automations}
          currentProject={currentProject}
          projects={projectState.projects}
          session={session}
          status={credentialStatus}
          settings={settings}
          threads={threadState.threads}
          view={settingsView}
          onClose={() => setSettingsView(null)}
          onDelete={deleteCredential}
          onDiagnose={(diagnosticSettings, apiKey) =>
            settingsService.diagnose({
              settings: diagnosticSettings,
              ...(apiKey ? { apiKey } : {}),
            })
          }
          onSave={saveCredential}
          onSaveSettings={saveSettings}
          onViewChange={setSettingsView}
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
    tokenUsage: state.tokenUsage ?? options.existingThread?.tokenUsage ?? null,
    diff: state.diff.slice(-100_000),
    createdAt: options.existingThread?.createdAt ?? now,
    updatedAt: now,
    archived: options.existingThread?.archived ?? false,
    unread: options.unread,
  };
}

function automationTaskPrompt(automation: AutomationRecord, projectName: string): string {
  return [
    `[Mimodex 自动化任务：${automation.title}]`,
    `项目：${projectName}`,
    "",
    automation.prompt,
  ].join("\n");
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
          <div><strong>Mimodex</strong><span>首次设置 · v{APP_VERSION}</span></div>
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

function SettingsHub({
  automations,
  currentProject,
  projects,
  session,
  settings,
  status,
  threads,
  view,
  onClose,
  onDelete,
  onDiagnose,
  onSave,
  onSaveSettings,
  onViewChange,
}: {
  automations: AutomationRecord[];
  currentProject: ProjectState["projects"][number] | null;
  projects: ProjectState["projects"];
  session: DesktopSessionController;
  settings: AppSettings;
  status: CredentialStatus;
  threads: ThreadRecord[];
  view: SettingsView;
  onClose: () => void;
  onDelete: () => Promise<void>;
  onDiagnose: (settings: AppSettings, apiKey?: string) => Promise<ConnectionDiagnostic>;
  onSave: (apiKey: string) => Promise<void>;
  onSaveSettings: (settings: AppSettings) => Promise<void>;
  onViewChange: (view: SettingsView) => void;
}) {
  if (view === "menu") {
    return (
      <SettingsMenu
        status={status}
        onClose={onClose}
        onViewChange={onViewChange}
      />
    );
  }

  if (view === "dashboard") {
    return (
      <DashboardSettingsDialog
        automations={automations}
        currentProject={currentProject}
        projects={projects}
        session={session}
        threads={threads}
        onBack={() => onViewChange("menu")}
        onClose={onClose}
      />
    );
  }

  return (
    <ModelSettingsDialog
      status={status}
      settings={settings}
      onBack={() => onViewChange("menu")}
      onClose={onClose}
      onDelete={onDelete}
      onDiagnose={onDiagnose}
      onSave={onSave}
      onSaveSettings={onSaveSettings}
    />
  );
}

function SettingsMenu({
  status,
  onClose,
  onViewChange,
}: {
  status: CredentialStatus;
  onClose: () => void;
  onViewChange: (view: SettingsView) => void;
}) {
  const credentialReady = status.configured ? credentialStatusLabel(status) : "尚未配置";
  return (
    <div className="settings-menu-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-label="设置"
        aria-modal="true"
        className="settings-menu-popover"
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="settings-menu-item" type="button" onClick={() => onViewChange("model")}>
          <SettingsMenuIcon name="model" />
          <span>设置模型</span>
          <small>{credentialReady}</small>
        </button>
        <button className="settings-menu-item" type="button" onClick={() => onViewChange("dashboard")}>
          <SettingsMenuIcon name="dashboard" />
          <span>仪表盘</span>
          <small>项目、任务与 Token</small>
        </button>
      </section>
    </div>
  );
}

function ModelSettingsDialog({
  settings,
  status,
  onBack,
  onClose,
  onDelete,
  onDiagnose,
  onSave,
  onSaveSettings,
}: {
  settings: AppSettings;
  status: CredentialStatus;
  onBack: () => void;
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
      <section aria-label="模型设置" aria-modal="true" className="settings-dialog" role="dialog">
        <header>
          <div className="settings-title-row">
            <button aria-label="返回设置" className="settings-back-button" type="button" onClick={onBack}>
              ‹
            </button>
            <div><p className="eyebrow">设置模型</p><h2>MiMo Provider</h2></div>
          </div>
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

function DashboardSettingsDialog({
  automations,
  currentProject,
  projects,
  session,
  threads,
  onBack,
  onClose,
}: {
  automations: AutomationRecord[];
  currentProject: ProjectState["projects"][number] | null;
  projects: ProjectState["projects"];
  session: DesktopSessionController;
  threads: ThreadRecord[];
  onBack: () => void;
  onClose: () => void;
}) {
  return (
    <div className="settings-backdrop" role="presentation">
      <section aria-label="仪表盘" aria-modal="true" className="settings-dialog dashboard-dialog" role="dialog">
        <header>
          <div className="settings-title-row">
            <button aria-label="返回设置" className="settings-back-button" type="button" onClick={onBack}>
              ‹
            </button>
            <div><p className="eyebrow">仪表盘</p><h2>项目统计</h2></div>
          </div>
          <button aria-label="关闭设置" type="button" onClick={onClose}>×</button>
        </header>
        <SettingsDashboard
          automations={automations}
          currentProject={currentProject}
          projects={projects}
          session={session}
          threads={threads}
        />
      </section>
    </div>
  );
}

function SettingsDashboard({
  automations,
  currentProject,
  projects,
  session,
  threads,
}: {
  automations: AutomationRecord[];
  currentProject: ProjectState["projects"][number] | null;
  projects: ProjectState["projects"];
  session: DesktopSessionController;
  threads: ThreadRecord[];
}) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const stats = useMemo(
    () => createDashboardStats({ automations, currentProject, projects, state, threads }),
    [automations, currentProject, projects, state, threads],
  );

  return (
    <div className="settings-dashboard">
      <div className="dashboard-metric-grid">
        <DashboardMetric
          label="项目"
          value={stats.projectCount.toLocaleString("zh-CN")}
          detail={`${stats.availableProjectCount.toLocaleString("zh-CN")} 个可用`}
        />
        <DashboardMetric
          label="对话线程"
          value={stats.conversationCount.toLocaleString("zh-CN")}
          detail={`${stats.activeConversationCount.toLocaleString("zh-CN")} 个活跃 · ${stats.archivedConversationCount.toLocaleString("zh-CN")} 个归档`}
        />
        <DashboardMetric
          label="任务消息"
          value={stats.taskCount.toLocaleString("zh-CN")}
          detail={`${stats.runningCount.toLocaleString("zh-CN")} 个进行中`}
        />
        <DashboardMetric
          label="Token 消耗"
          value={formatDashboardTokens(stats.totalTokens)}
          detail={`${stats.tokenThreadCount.toLocaleString("zh-CN")} 个线程有统计`}
        />
      </div>

      <section className="dashboard-section">
        <h3>当前线程 Token</h3>
        <dl className="dashboard-token-grid">
          <div>
            <dt>总量</dt>
            <dd>{formatDashboardTokens(stats.currentTokenUsage?.totalTokens ?? null)}</dd>
          </div>
          <div>
            <dt>输入</dt>
            <dd>{formatDashboardTokens(stats.currentTokenUsage?.inputTokens ?? null)}</dd>
          </div>
          <div>
            <dt>输出</dt>
            <dd>{formatDashboardTokens(stats.currentTokenUsage?.outputTokens ?? null)}</dd>
          </div>
          <div>
            <dt>上下文</dt>
            <dd>{formatContextRatio(stats.currentTokenUsage)}</dd>
          </div>
        </dl>
      </section>

      <section className="dashboard-section dashboard-columns">
        <div>
          <h3>任务状态</h3>
          <dl className="dashboard-list">
            <DashboardListItem label="已完成" value={stats.completedCount} />
            <DashboardListItem label="进行中" value={stats.runningCount} />
            <DashboardListItem label="失败" value={stats.failedCount} />
            <DashboardListItem label="已中断" value={stats.interruptedCount} />
          </dl>
        </div>
        <div>
          <h3>自动化</h3>
          <dl className="dashboard-list">
            <DashboardListItem label="任务总数" value={stats.automationCount} />
            <DashboardListItem label="定时启用" value={stats.enabledAutomationCount} />
            <DashboardListItem label="已运行次数" value={stats.automationRunCount} />
            <DashboardListItem label="失败记录" value={stats.automationFailureCount} />
          </dl>
        </div>
      </section>

      <section className="dashboard-section">
        <h3>项目分布</h3>
        <div className="dashboard-project-list">
          {stats.projectRows.length === 0 ? (
            <p>添加项目后显示统计。</p>
          ) : (
            stats.projectRows.map((project) => (
              <div className="dashboard-project-row" key={project.id}>
                <div>
                  <strong>{project.name}</strong>
                  <span>{project.path}</span>
                </div>
                <dl>
                  <div>
                    <dt>对话</dt>
                    <dd>{project.conversations.toLocaleString("zh-CN")}</dd>
                  </div>
                  <div>
                    <dt>任务</dt>
                    <dd>{project.tasks.toLocaleString("zh-CN")}</dd>
                  </div>
                  <div>
                    <dt>Token</dt>
                    <dd>{formatDashboardTokens(project.tokens)}</dd>
                  </div>
                </dl>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function DashboardMetric({
  detail,
  label,
  value,
}: {
  detail: string;
  label: string;
  value: string;
}) {
  return (
    <div className="dashboard-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function DashboardListItem({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value.toLocaleString("zh-CN")}</dd>
    </div>
  );
}

function SettingsMenuIcon({ name }: { name: "dashboard" | "model" }) {
  const paths: Record<typeof name, ReactNode> = {
    dashboard: (
      <>
        <path d="M4 11.5a6 6 0 1 1 12 0" />
        <path d="M10 11.5l3-3" />
        <path d="M5.2 14.5h9.6" />
      </>
    ),
    model: (
      <>
        <circle cx="10" cy="10" r="2.4" />
        <path d="M8.8 2.9h2.4l.4 2.1c.5.1.9.3 1.3.5l1.8-1.2 1.7 1.7-1.2 1.8c.2.4.4.8.5 1.3l2.1.4v2.4l-2.1.4c-.1.5-.3.9-.5 1.3l1.2 1.8-1.7 1.7-1.8-1.2c-.4.2-.8.4-1.3.5l-.4 2.1H8.8l-.4-2.1c-.5-.1-.9-.3-1.3-.5l-1.8 1.2-1.7-1.7 1.2-1.8c-.2-.4-.4-.8-.5-1.3l-2.1-.4V9.5l2.1-.4c.1-.5.3-.9.5-1.3L3.6 6l1.7-1.7 1.8 1.2c.4-.2.8-.4 1.3-.5l.4-2.1Z" />
      </>
    ),
  };
  return (
    <svg aria-hidden="true" className="settings-menu-icon" focusable="false" viewBox="0 0 20 20">
      {paths[name]}
    </svg>
  );
}

type DashboardProjectRow = {
  conversations: number;
  id: string;
  name: string;
  path: string;
  tasks: number;
  tokens: number | null;
};

type DashboardStats = {
  activeConversationCount: number;
  archivedConversationCount: number;
  automationCount: number;
  automationFailureCount: number;
  automationRunCount: number;
  availableProjectCount: number;
  completedCount: number;
  conversationCount: number;
  currentTokenUsage: TokenUsage | null;
  enabledAutomationCount: number;
  failedCount: number;
  interruptedCount: number;
  projectCount: number;
  projectRows: DashboardProjectRow[];
  runningCount: number;
  taskCount: number;
  tokenThreadCount: number;
  totalTokens: number | null;
};

function createDashboardStats({
  automations,
  currentProject,
  projects,
  state,
  threads,
}: {
  automations: AutomationRecord[];
  currentProject: ProjectState["projects"][number] | null;
  projects: ProjectState["projects"];
  state: SessionState;
  threads: ThreadRecord[];
}): DashboardStats {
  const dashboardThreads = mergeCurrentSessionThread(threads, state, currentProject);
  const activeThreads = dashboardThreads.filter((thread) => !thread.archived);
  const usageThreads = dashboardThreads.filter((thread) => thread.tokenUsage);
  const totalTokens = sumTokenUsage(usageThreads.map((thread) => thread.tokenUsage ?? null));
  const currentThreadUsage =
    state.tokenUsage ??
    dashboardThreads.find((thread) => thread.id === state.threadId)?.tokenUsage ??
    null;
  const projectRows = projects
    .map((project) => {
      const projectThreads = dashboardThreads.filter((thread) => thread.projectId === project.id);
      const projectTokens = sumTokenUsage(projectThreads.map((thread) => thread.tokenUsage ?? null));
      return {
        conversations: projectThreads.length,
        id: project.id,
        name: project.name,
        path: project.path,
        tasks: projectThreads.reduce((count, thread) => count + taskCountForThread(thread), 0),
        tokens: projectTokens,
      };
    })
    .sort((left, right) =>
      (right.tokens ?? 0) - (left.tokens ?? 0) ||
      right.conversations - left.conversations ||
      left.name.localeCompare(right.name, "zh-CN"),
    );

  return {
    activeConversationCount: activeThreads.length,
    archivedConversationCount: dashboardThreads.length - activeThreads.length,
    automationCount: automations.length,
    automationFailureCount: automations.filter((automation) => automation.lastStatus === "failed").length,
    automationRunCount: automations.reduce((count, automation) => count + automation.runCount, 0),
    availableProjectCount: projects.filter((project) => project.available).length,
    completedCount: dashboardThreads.filter((thread) => thread.turnStatus === "completed").length,
    conversationCount: dashboardThreads.length,
    currentTokenUsage: currentThreadUsage,
    enabledAutomationCount: automations.filter((automation) => automation.enabled).length,
    failedCount: dashboardThreads.filter((thread) => thread.turnStatus === "failed").length,
    interruptedCount: dashboardThreads.filter((thread) => thread.turnStatus === "interrupted").length,
    projectCount: projects.length,
    projectRows,
    runningCount: dashboardThreads.filter((thread) => thread.turnStatus === "inProgress").length,
    taskCount: dashboardThreads.reduce((count, thread) => count + taskCountForThread(thread), 0),
    tokenThreadCount: usageThreads.length,
    totalTokens,
  };
}

function mergeCurrentSessionThread(
  threads: ThreadRecord[],
  state: SessionState,
  currentProject: ProjectState["projects"][number] | null,
): ThreadRecord[] {
  const merged = threads.map((thread) =>
    thread.id === state.threadId
      ? { ...thread, tokenUsage: state.tokenUsage ?? thread.tokenUsage ?? null }
      : thread,
  );
  if (!state.threadId || merged.some((thread) => thread.id === state.threadId) || !currentProject) {
    return merged;
  }
  const firstUserMessage = state.timeline.find((entry) => entry.kind === "user")?.content.trim();
  return [
    {
      id: state.threadId,
      projectId: currentProject.id,
      projectPath: state.projectPath ?? currentProject.path,
      title: compactTitle(firstUserMessage || "当前线程"),
      model: state.model === "mimo-v2.5-pro" ? "mimo-v2.5-pro" : "mimo-v2.5",
      sandbox: state.sandbox,
      turnStatus: state.turnStatus,
      timeline: Array.from(state.timeline),
      tokenUsage: state.tokenUsage,
      diff: state.diff,
      createdAt: state.timeline[0]?.startedAt ?? Date.now(),
      updatedAt: Date.now(),
      archived: false,
      unread: false,
    },
    ...merged,
  ];
}

function taskCountForThread(thread: ThreadRecord): number {
  return thread.timeline.filter((entry) => entry.kind === "user").length;
}

function sumTokenUsage(usages: Array<TokenUsage | null>): number | null {
  const known = usages.filter((usage): usage is TokenUsage => Boolean(usage));
  if (known.length === 0) {
    return null;
  }
  return known.reduce((total, usage) => total + usage.totalTokens, 0);
}

function formatDashboardTokens(value: number | null | undefined): string {
  return value === null || value === undefined ? "等待统计" : value.toLocaleString("zh-CN");
}

function formatContextRatio(usage: TokenUsage | null): string {
  if (!usage) {
    return "等待统计";
  }
  if (!usage.contextWindow || usage.contextWindow <= 0) {
    return "容量未知";
  }
  const ratio = usage.totalTokens / usage.contextWindow;
  const percent = ratio > 0 && ratio < 0.01 ? "<1%" : `${Math.round(ratio * 100).toLocaleString("zh-CN")}%`;
  return `${percent} · ${formatDashboardTokens(usage.totalTokens)} / ${formatDashboardTokens(usage.contextWindow)}`;
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
