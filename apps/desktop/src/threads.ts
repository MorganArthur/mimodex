import { invoke, isTauri } from "@tauri-apps/api/core";

import type {
  ModelId,
  SandboxMode,
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
};

export type ThreadState = {
  threads: ThreadRecord[];
  selectedThreadId: string | null;
};

export interface ThreadService {
  list(): Promise<ThreadState>;
  upsert(thread: ThreadRecord): Promise<ThreadState>;
  select(threadId: string | null): Promise<ThreadState>;
}

export function createThreadService(): ThreadService {
  return isTauri() ? new TauriThreadService() : new DemoThreadService();
}

class TauriThreadService implements ThreadService {
  list(): Promise<ThreadState> {
    return invoke("list_threads");
  }

  upsert(thread: ThreadRecord): Promise<ThreadState> {
    return invoke("upsert_thread", { thread });
  }

  select(threadId: string | null): Promise<ThreadState> {
    return invoke("select_thread", { threadId });
  }
}

class DemoThreadService implements ThreadService {
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
      },
      {
        id: `${id}-assistant`,
        kind: "assistant",
        title: "MiMo",
        content: "这是浏览器开发环境中的可恢复线程投影。",
        status: "completed",
      },
    ],
    diff: "",
    createdAt: updatedAt,
    updatedAt,
  };
}
