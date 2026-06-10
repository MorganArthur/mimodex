import { useEffect, useState, useSyncExternalStore, type FormEvent } from "react";

import {
  type ApprovalDecision,
  type DesktopSessionController,
  type PendingApproval,
  type SessionState,
  type TimelineEntry,
} from "@mimodex/desktop-core";

export type AppProps = {
  session: DesktopSessionController;
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

export function App({ session }: AppProps) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [projectPath, setProjectPath] = useState("D:\\0WORKSPACE\\mimodex");
  const [model, setModel] = useState<"mimo-v2.5" | "mimo-v2.5-pro">("mimo-v2.5");
  const [sandbox, setSandbox] = useState<"danger-full-access" | "read-only" | "workspace-write">(
    "workspace-write",
  );
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void session.connect().catch(() => undefined);
  }, [session]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!message.trim() || submitting) {
      return;
    }
    setSubmitting(true);
    try {
      await session.startTask({ text: message, projectPath, model, sandbox });
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

        <button className="new-thread" type="button">
          <span>+</span>
          新建线程
        </button>

        <div className="sidebar-section">
          <div className="section-heading">
            <span>项目</span>
            <button type="button" aria-label="添加项目">+</button>
          </div>
          <div className="project-row active">
            <span className="project-icon">MD</span>
            <div>
              <strong>mimodex</strong>
              <span>main</span>
            </div>
            <i />
          </div>
        </div>

        <div className="sidebar-section threads">
          <div className="section-heading">
            <span>最近线程</span>
          </div>
          <button className="thread-row active" type="button">
            <span className="thread-state running" />
            <div>
              <strong>桌面 Runtime 接入</strong>
              <span>{state.turnStatus === "inProgress" ? "正在执行" : "刚刚更新"}</span>
            </div>
          </button>
          <button className="thread-row" type="button">
            <span className="thread-state" />
            <div>
              <strong>MiMo Provider 验证</strong>
              <span>昨天</span>
            </div>
          </button>
        </div>

        <div className="sidebar-footer">
          <span className={`connection-dot ${state.connection}`} />
          <div>
            <strong>{statusLabels[state.connection]}</strong>
            <span>{state.platform ?? "本地演示连接"}</span>
          </div>
          <button type="button" aria-label="打开设置">···</button>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">mimodex / main</p>
            <h1>桌面 Runtime 接入</h1>
          </div>
          <div className="topbar-actions">
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

        <section className="conversation">
          {state.timeline.length === 0 ? (
            <WelcomePanel onSelect={setMessage} />
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
                <input
                  aria-label="项目路径"
                  value={projectPath}
                  onChange={(event) => setProjectPath(event.target.value)}
                />
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
          <p className="eyebrow">当前边界</p>
          <h2>{sandboxLabel(sandbox)}</h2>
          <p>{sandboxDescription(sandbox)}</p>
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

function WelcomePanel({ onSelect }: { onSelect: (message: string) => void }) {
  return (
    <div className="welcome-panel">
      <span className="welcome-kicker">LOCAL-FIRST CODING AGENT</span>
      <h2>把任务交给 MiMo，<br />把每一步留在你眼前。</h2>
      <p>当前切片已接通线程、轮次、流式事件、审批和中断状态。输入任务即可体验完整交互。</p>
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
