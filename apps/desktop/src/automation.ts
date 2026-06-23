import { invoke, isTauri } from "@tauri-apps/api/core";

import type { ModelId, SandboxMode } from "@mimodex/desktop-core";

export type AutomationCadence = "daily" | "hourly" | "manual" | "weekly";
export type AutomationRunStatus = "completed" | "failed" | "interrupted" | "running";

export type AutomationRecord = {
  id: string;
  projectId: string;
  title: string;
  prompt: string;
  enabled: boolean;
  cadence: AutomationCadence;
  timeOfDay: string;
  dayOfWeek: number | null;
  model: ModelId;
  sandbox: SandboxMode;
  nextRunAt: number | null;
  lastRunAt: number | null;
  lastCompletedAt: number | null;
  lastStatus: AutomationRunStatus | "idle";
  lastError: string | null;
  lastThreadId: string | null;
  runCount: number;
  createdAt: number;
  updatedAt: number;
};

export type AutomationDraft = {
  projectId: string;
  title: string;
  prompt: string;
  enabled: boolean;
  cadence: AutomationCadence;
  timeOfDay: string;
  dayOfWeek: number | null;
  model: ModelId;
  sandbox: SandboxMode;
};

export type AutomationState = {
  automations: AutomationRecord[];
};

export type AutomationRunRecord = {
  automationId: string;
  status: AutomationRunStatus;
  lastRunAt: number;
  completedAt: number | null;
  nextRunAt: number | null;
  threadId: string | null;
  error: string | null;
};

type StoredAutomationDraft = AutomationDraft & {
  nextRunAt: number | null;
};

export interface AutomationService {
  list(): Promise<AutomationState>;
  create(input: AutomationDraft): Promise<AutomationState>;
  update(automationId: string, input: AutomationDraft): Promise<AutomationState>;
  delete(automationId: string): Promise<AutomationState>;
  recordRun(run: AutomationRunRecord): Promise<AutomationState>;
}

export const AUTOMATION_CADENCE_OPTIONS: Array<{
  description: string;
  label: string;
  value: AutomationCadence;
}> = [
  { description: "只在你手动点击运行时执行。", label: "手动", value: "manual" },
  { description: "每小时在指定分钟执行一次。", label: "每小时", value: "hourly" },
  { description: "每天在指定时间执行一次。", label: "每天", value: "daily" },
  { description: "每周在指定星期和时间执行一次。", label: "每周", value: "weekly" },
];

export const AUTOMATION_WEEKDAY_OPTIONS = [
  { label: "周一", value: 1 },
  { label: "周二", value: 2 },
  { label: "周三", value: 3 },
  { label: "周四", value: 4 },
  { label: "周五", value: 5 },
  { label: "周六", value: 6 },
  { label: "周日", value: 7 },
];

export function createAutomationService(): AutomationService {
  return isTauri() ? new TauriAutomationService() : new DemoAutomationService();
}

export function normalizeAutomationDraft(input: AutomationDraft): StoredAutomationDraft {
  const cadence = normalizeCadence(input.cadence);
  const timeOfDay = normalizeTimeOfDay(input.timeOfDay);
  const normalized: AutomationDraft = {
    projectId: input.projectId.trim(),
    title: compactTitle(input.title.trim() || "未命名自动化"),
    prompt: input.prompt.trim(),
    enabled: input.enabled,
    cadence,
    timeOfDay,
    dayOfWeek:
      cadence === "weekly" ? normalizeDayOfWeek(input.dayOfWeek) : null,
    model: input.model === "mimo-v2.5-pro" ? "mimo-v2.5-pro" : "mimo-v2.5",
    sandbox:
      input.sandbox === "danger-full-access" || input.sandbox === "read-only"
        ? input.sandbox
        : "workspace-write",
  };
  return {
    ...normalized,
    nextRunAt: normalized.enabled ? nextAutomationRunAt(normalized) : null,
  };
}

export function nextAutomationRunAt(
  automation: Pick<AutomationDraft, "cadence" | "dayOfWeek" | "timeOfDay">,
  from = Date.now(),
): number | null {
  const cadence = normalizeCadence(automation.cadence);
  if (cadence === "manual") {
    return null;
  }

  const { hours, minutes } = parseTimeOfDay(automation.timeOfDay);
  const start = new Date(from);
  const candidate = new Date(from);
  candidate.setSeconds(0, 0);

  if (cadence === "hourly") {
    candidate.setMinutes(minutes, 0, 0);
    if (candidate.getTime() <= from) {
      candidate.setHours(candidate.getHours() + 1);
    }
    return candidate.getTime();
  }

  candidate.setHours(hours, minutes, 0, 0);
  if (cadence === "daily") {
    if (candidate.getTime() <= from) {
      candidate.setDate(candidate.getDate() + 1);
    }
    return candidate.getTime();
  }

  const targetDay = normalizeDayOfWeek(automation.dayOfWeek);
  const currentDay = start.getDay() === 0 ? 7 : start.getDay();
  let daysAhead = targetDay - currentDay;
  if (daysAhead < 0 || (daysAhead === 0 && candidate.getTime() <= from)) {
    daysAhead += 7;
  }
  candidate.setDate(candidate.getDate() + daysAhead);
  return candidate.getTime();
}

class TauriAutomationService implements AutomationService {
  list(): Promise<AutomationState> {
    return invoke("list_automations");
  }

  create(input: AutomationDraft): Promise<AutomationState> {
    return invoke("create_automation", {
      automation: normalizeAutomationDraft(input),
    });
  }

  update(automationId: string, input: AutomationDraft): Promise<AutomationState> {
    return invoke("update_automation", {
      automation: normalizeAutomationDraft(input),
      automationId,
    });
  }

  delete(automationId: string): Promise<AutomationState> {
    return invoke("delete_automation", { automationId });
  }

  recordRun(run: AutomationRunRecord): Promise<AutomationState> {
    return invoke("record_automation_run", { run });
  }
}

class DemoAutomationService implements AutomationService {
  #state: AutomationState = {
    automations: [
      {
        ...normalizeAutomationDraft({
          cadence: "daily",
          dayOfWeek: null,
          enabled: true,
          model: "mimo-v2.5",
          projectId: "d:\\0workspace\\mimodex",
          prompt: "检查当前项目状态，报告阻塞 v0.2.0 发布的风险。",
          sandbox: "workspace-write",
          timeOfDay: "09:00",
          title: "每日项目体检",
        }),
        createdAt: Date.now() - 86_400_000,
        id: "demo-automation-daily-check",
        lastCompletedAt: null,
        lastError: null,
        lastRunAt: null,
        lastStatus: "idle",
        lastThreadId: null,
        runCount: 0,
        updatedAt: Date.now() - 86_400_000,
      },
    ],
  };

  async list(): Promise<AutomationState> {
    return this.#state;
  }

  async create(input: AutomationDraft): Promise<AutomationState> {
    const now = Date.now();
    const automation: AutomationRecord = {
      ...normalizeAutomationDraft(input),
      createdAt: now,
      id: `automation-${now}-${Math.random().toString(36).slice(2, 7)}`,
      lastCompletedAt: null,
      lastError: null,
      lastRunAt: null,
      lastStatus: "idle",
      lastThreadId: null,
      runCount: 0,
      updatedAt: now,
    };
    this.#state = { automations: [automation, ...this.#state.automations] };
    return this.#state;
  }

  async update(automationId: string, input: AutomationDraft): Promise<AutomationState> {
    const draft = normalizeAutomationDraft(input);
    this.#state = {
      automations: this.#state.automations.map((automation) =>
        automation.id === automationId
          ? { ...automation, ...draft, updatedAt: Date.now() }
          : automation,
      ),
    };
    return this.#state;
  }

  async delete(automationId: string): Promise<AutomationState> {
    this.#state = {
      automations: this.#state.automations.filter((automation) => automation.id !== automationId),
    };
    return this.#state;
  }

  async recordRun(run: AutomationRunRecord): Promise<AutomationState> {
    this.#state = {
      automations: this.#state.automations.map((automation) =>
        automation.id === run.automationId
          ? {
              ...automation,
              lastCompletedAt: run.completedAt,
              lastError: run.error,
              lastRunAt: run.lastRunAt,
              lastStatus: run.status,
              lastThreadId: run.threadId,
              nextRunAt: run.nextRunAt,
              runCount:
                run.status === "completed" || run.status === "failed" || run.status === "interrupted"
                  ? automation.runCount + 1
                  : automation.runCount,
              updatedAt: Date.now(),
            }
          : automation,
      ),
    };
    return this.#state;
  }
}

function compactTitle(value: string): string {
  return value.replace(/\s+/g, " ").slice(0, 80);
}

function normalizeCadence(cadence: AutomationCadence): AutomationCadence {
  return cadence === "hourly" || cadence === "weekly" || cadence === "manual"
    ? cadence
    : "daily";
}

function normalizeDayOfWeek(value: number | null): number {
  return value !== null && Number.isInteger(value) && value >= 1 && value <= 7 ? value : 1;
}

function normalizeTimeOfDay(value: string): string {
  const { hours, minutes } = parseTimeOfDay(value);
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
}

function parseTimeOfDay(value: string): { hours: number; minutes: number } {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) {
    return { hours: 9, minutes: 0 };
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) {
    return { hours: 9, minutes: 0 };
  }
  return {
    hours: Math.min(23, Math.max(0, hours)),
    minutes: Math.min(59, Math.max(0, minutes)),
  };
}
