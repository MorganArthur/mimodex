# Mimodex

Mimodex 是一款由 MiMo v2.5 与 MiMo v2.5 Pro API 驱动的本地优先桌面编程 Agent。

项目已完成产品定义、MiMo Provider 验证和首批 Runtime 接入，当前正在开发桌面端 MVP。

## 产品方向

Mimodex 参考 Codex 桌面端的核心工作方式：

- 每个对话线程绑定一个本地项目；
- Agent 可以检查代码、编辑文件、运行命令并使用 Git；
- 高风险操作必须经过审批；
- 通过活动记录和 Diff 审阅所有变更；
- 保存足够完整的会话与工具状态，以便安全恢复任务。

首个版本专注于打通本地编程 Agent 闭环。云端任务、自动化、浏览器控制、
多 Agent 编排和插件市场暂不进入首版范围。

## 方案文档

- [产品需求文档](docs/product/PRD.md)
- [架构总览](docs/architecture/README.md)
- [ADR-0001：采用 Tauri 桌面外壳与 Rust Agent Core](docs/architecture/decisions/ADR-0001-tauri-rust-agent-core.md)
- [ADR-0002：基于 Codex App Server 分支开发 Agent Runtime](docs/architecture/decisions/ADR-0002-fork-codex-app-server.md)
- [ADR-0003：实现原生 MiMo Chat Completions Provider](docs/architecture/decisions/ADR-0003-native-mimo-provider.md)
- [ADR-0004：分离沙箱强制边界与审批策略](docs/architecture/decisions/ADR-0004-sandbox-and-approvals.md)
- [ADR-0005：在本地持久化可重放的 Agent 线程](docs/architecture/decisions/ADR-0005-local-thread-persistence.md)
- [ADR-0006：本地只编辑源码，原生构建与 Windows 打包由 GitHub Actions 完成](docs/architecture/decisions/ADR-0006-ci-only-native-builds.md)
- [Windows 11 CI 构建与发布方案](docs/delivery/WINDOWS_CI_RELEASE.md)
- [MiMo Runtime Adapter 实现计划](docs/implementation/RUNTIME_ADAPTER_PLAN.md)
- [桌面 Runtime 客户端接入计划](docs/implementation/DESKTOP_RUNTIME_CLIENT_PLAN.md)
- [桌面应用服务与交互壳实现说明](docs/implementation/DESKTOP_APP_SHELL_PLAN.md)
- [Tauri Sidecar Windows 技术预览说明](docs/implementation/TAURI_SIDECAR_PREVIEW.md)
- [MiMo Provider 技术验证清单](docs/validation/MIMO_PROVIDER_SPIKE.md)
- [MiMo Provider Spike 当前状态](docs/validation/MIMO_PROVIDER_SPIKE_STATUS.md)
- [默认模型真实基础流式探针证据](docs/validation/evidence/2026-06-09-mimo-v2.5-baseline.md)
- [高级模型真实基础流式探针证据](docs/validation/evidence/2026-06-09-mimo-v2.5-pro-baseline.md)
- [默认模型真实工具循环证据](docs/validation/evidence/2026-06-09-mimo-v2.5-tool-loop.md)
- [默认模型真实恢复证据](docs/validation/evidence/2026-06-09-mimo-v2.5-resume.md)
- [高级模型真实工具循环证据](docs/validation/evidence/2026-06-09-mimo-v2.5-pro-tool-loop.md)
- [默认模型工具恢复与同响应多工具调用证据](docs/validation/evidence/2026-06-09-mimo-v2.5-recovery-and-parallel-tools.md)
- [默认模型流式取消与第二次恢复证据](docs/validation/evidence/2026-06-09-mimo-v2.5-cancellation-and-second-resume.md)
- [默认模型负向重放不一致证据](docs/validation/evidence/2026-06-09-mimo-v2.5-negative-replay-discrepancy.md)
- [MiMo 推理内容负向重放矩阵证据](docs/validation/evidence/2026-06-09-mimo-negative-replay-matrix.md)
- [Codex Runtime 接入盘点](docs/architecture/CODEX_RUNTIME_INVENTORY.md)

## 当前已确认决策

- Windows 为首个支持平台，之后支持 macOS。
- 桌面界面使用 Tauri 2、React 与 TypeScript。
- 本地 Agent Runtime 基于开源 Codex Rust app-server 与 core 的维护分支。
- MiMo 以原生 Provider 接入，不仅仅修改 OpenAI 兼容 Base URL。
- 首版由用户自行提供 MiMo API 凭据。
- 首版默认展示并使用 `mimo-v2.5`，`mimo-v2.5-pro` 放入高级模型选择。
- 项目文件、会话记录和执行记录默认仅保存在本地。
- 本地不安装 Rust 工具链；原生编译、测试与 Windows 安装包由 GitHub Actions 完成。
- Runtime 首阶段使用固定 Codex 上游 commit 与版本化补丁队列维护修改。
- Windows 首版安装包优化目标不超过 `100 MiB`，发布硬上限为 `120 MiB`，安装后
  文件总量不超过 `350 MiB`。

## 当前开发阶段

MiMo Provider 技术验证清单中的强制退出条件已经通过。桌面界面、Tauri sidecar 和
Mimodex Runtime 已完成首轮代码接入，并由 Windows Preview CI 产出首个 `55.98 MiB`
可安装技术预览。当前已补齐连接诊断、自定义端点、结构化错误、完全访问警告和审批
边界详情，工作重点转为按 Windows 11 私测清单验收 Agent 闭环。
