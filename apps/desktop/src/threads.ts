import { invoke, isTauri } from "@tauri-apps/api/core";

import type {
  ModelId,
  SandboxMode,
  SessionRuntimeEvent,
  TimelineEntry,
  TurnStatus,
} from "@mimodex/desktop-core";

export type ThreadRecord = {
  id: string;
  projectId: string;
  projectPath: string;
  title: string;
  model: ModelId;
  sandbox: SandboxMode;
  turnStatus: TurnStatus;
  timeline: TimelineEntry[];
  diff: string;
  createdAt: number;
  updatedAt: number;
  archived: boolean;
};

export type ThreadState = {
  threads: ThreadRecord[];
  selectedThreadId: string | null;
};

export type ThreadActivityEvent = SessionRuntimeEvent & {
  occurredAt: number;
};

export interface ThreadService {
  list(): Promise<ThreadState>;
  listActivity(threadId: string): Promise<ThreadActivityEvent[]>;
  upsert(thread: ThreadRecord): Promise<ThreadState>;
  select(threadId: string | null): Promise<ThreadState>;
  setArchived(threadId: string, archived: boolean): Promise<ThreadState>;
  delete(threadId: string): Promise<ThreadState>;
  appendRuntimeEvents(events: SessionRuntimeEvent[]): Promise<void>;
}

export function createThreadService(): ThreadService {
  return isTauri() ? new TauriThreadService() : new DemoThreadService();
}

class TauriThreadService implements ThreadService {
  list(): Promise<ThreadState> {
    return invoke("list_threads");
  }

  listActivity(threadId: string): Promise<ThreadActivityEvent[]> {
    return invoke("list_thread_activity", { threadId });
  }

  upsert(thread: ThreadRecord): Promise<ThreadState> {
    return invoke("upsert_thread", { thread });
  }

  select(threadId: string | null): Promise<ThreadState> {
    return invoke("select_thread", { threadId });
  }

  setArchived(threadId: string, archived: boolean): Promise<ThreadState> {
    return invoke("set_thread_archived", { threadId, archived });
  }

  delete(threadId: string): Promise<ThreadState> {
    return invoke("delete_thread", { threadId });
  }

  appendRuntimeEvents(events: SessionRuntimeEvent[]): Promise<void> {
    return invoke("append_runtime_events", { events });
  }
}

class DemoThreadService implements ThreadService {
  readonly runtimeEvents: SessionRuntimeEvent[] = [];
  #state: ThreadState = {
    threads: [
      demoThread("demo-thread-runtime", "桌面 Runtime 接入", Date.now()),
      demoThread("demo-thread-provider", "MiMo Provider 验证", Date.now() - 86_400_000),
    ],
    selectedThreadId: null,
  };

  async list(): Promise<ThreadState> {
    return this.#state;
  }

  async listActivity(threadId: string): Promise<ThreadActivityEvent[]> {
    return this.runtimeEvents
      .filter((event) => event.threadId === threadId)
      .slice(-300)
      .reverse()
      .map((event, index) => ({ ...event, occurredAt: Date.now() - index }));
  }

  async upsert(thread: ThreadRecord): Promise<ThreadState> {
    const existing = this.#state.threads.find((candidate) => candidate.id === thread.id);
    const next = { ...thread, createdAt: existing?.createdAt ?? thread.createdAt };
    this.#state = {
      threads: [next, ...this.#state.threads.filter((candidate) => candidate.id !== thread.id)],
      selectedThreadId: thread.id,
    };
    return this.#state;
  }

  async select(threadId: string | null): Promise<ThreadState> {
    this.#state = {
      ...this.#state,
      selectedThreadId: threadId,
      threads:
        threadId === null
          ? this.#state.threads
          : this.#state.threads
              .map((thread) => (thread.id === threadId ? { ...thread, updatedAt: Date.now() } : thread))
              .sort((left, right) => right.updatedAt - left.updatedAt),
    };
    return this.#state;
  }

  async setArchived(threadId: string, archived: boolean): Promise<ThreadState> {
    this.#state = {
      threads: this.#state.threads.map((thread) =>
        thread.id === threadId ? { ...thread, archived, updatedAt: Date.now() } : thread,
      ),
      selectedThreadId:
        archived && this.#state.selectedThreadId === threadId ? null : this.#state.selectedThreadId,
    };
    return this.#state;
  }

  async delete(threadId: string): Promise<ThreadState> {
    this.#state = {
      threads: this.#state.threads.filter((thread) => thread.id !== threadId),
      selectedThreadId: this.#state.selectedThreadId === threadId ? null : this.#state.selectedThreadId,
    };
    return this.#state;
  }

  async appendRuntimeEvents(events: SessionRuntimeEvent[]): Promise<void> {
    for (const event of events) {
      if (!this.runtimeEvents.some((candidate) => candidate.eventId === event.eventId)) {
        this.runtimeEvents.push(event);
      }
    }
  }
}

function demoThread(id: string, title: string, updatedAt: number): ThreadRecord {
  return {
    id,
    projectId: "d:\\0workspace\\mimodex",
    projectPath: "D:\\0WORKSPACE\\mimodex",
    title,
    model: "mimo-v2.5",
    sandbox: "workspace-write",
    turnStatus: "completed",
    timeline: [
      {
        id: `${id}-user`,
        kind: "user",
        title: "你",
        content: title,
        status: null,
        startedAt: updatedAt - 5_000,
        completedAt: updatedAt,
      },
      {
        id: `${id}-assistant`,
        kind: "assistant",
        title: "MiMo",
        content: "这是浏览器开发环境中的可恢复线程投影。",
        status: "completed",
        startedAt: updatedAt - 3_000,
        completedAt: updatedAt,
      },
    ],
    diff: "",
    createdAt: updatedAt,
    updatedAt,
    archived: false,
  };
}
