# ADR-0002：基于 Codex App Server 分支开发 Agent Runtime

- 状态：已接受，需通过验证门槛
- 日期：2026-06-09

## 背景

可信的编程 Agent 不只是一个 LLM 请求循环。它还需要线程与轮次语义、流式事件、
工具、审批、沙箱、进程管理、持久化、取消和上下文管理。

开源 Codex 仓库中的 Rust app-server 与 Agent Core 已经覆盖了许多相关问题。
其中 app-server 通过双向 JSON-RPC 协议为富客户端提供能力。

## 决策

创建并维护 Mimodex 自有分支，纳入相关的开源 Codex Rust 组件，包括 app-server
与 core Runtime。

首阶段使用“固定上游 commit + 版本化补丁队列”维护分支修改。GitHub Actions
检出完整 `codex-rs`、应用补丁并执行权威验证。补丁规模或冲突成本增大后，再迁移到
独立的 Codex GitHub fork。

Mimodex 将：

- 在适合产品的情况下保留线程、轮次、项目、事件、审批和工具概念；
- 新增原生 MiMo Provider 与必要的 Provider 中立抽象；
- 向 Tauri 客户端提供版本化本地 app-server 协议；
- 尽量将 Mimodex 专属 UI 和产品行为放在上游 Core 之外；
- 定期评估上游变化并选择性合并。

该决策以 Provider Spike 证明 MiMo 能支持所需 Agent 循环，且不会破坏 Core
关键约束为前提。

## 决策理由

- 复用成熟 Agent Runtime 概念，避免从零重建高风险执行与审批能力。
- 已具备适合富客户端的接口边界。
- 与产品参考的 Codex 工作模式保持一致。
- 代码使用 Apache-2.0 开源许可证。

## 影响

### 正面影响

- 更快获得可靠的本地 Agent Runtime。
- 复用流式活动、审批、恢复和工具模式。
- 更容易跟进上游安全与可靠性改进。

### 负面影响

- 需要持续维护分支并承担上游合并成本。
- 部分上游抽象与特定 Provider 或产品绑定，需要谨慎拆分。
- 若不主动审计，继承的假设可能限制产品行为。
- 发布时必须遵守 Apache-2.0 的声明与署名义务。

## 约束

- 每个 Mimodex Runtime 版本都记录对应上游 commit。
- 使用机器可读补丁清单或变更日志记录分支专属修改。
- `runtime/upstream.lock.json` 与 `runtime/patches/series` 是首阶段分支基线和修改范围
  的权威记录。
- 不得只为简化 UI 而改变 Runtime 权威语义。
- 合并上游更新前，对 Provider、审批边界和线程恢复运行一致性测试。
- 公开发布前进行许可证和第三方依赖审查。

## 未采用方案

### 从零构建 Agent Runtime

首版不采用。其安全与可靠性范围相对产品当前差异化目标过大。

### 仅修改 Base URL，运行未改动的 Codex Runtime

不采用。当前自定义 Provider 的 wire 假设无法直接匹配 MiMo Chat Completions
的工具调用与推理重放要求。

### 将现有 CLI 作为黑盒子进程调用

不采用。Mimodex 需要结构化审批、事件和状态，不能依赖解析终端文本。
