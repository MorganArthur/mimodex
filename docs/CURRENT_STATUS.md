# Mimodex 当前项目状态

- 状态：桌面 MVP 功能闭环已建立，`v0.1.3` Windows Pre-release 已发布
- 最新 Windows Release 构建提交：`v0.1.3` 标签提交，Actions run `27599562104`
- 最后更新：2026-06-16
- 当前版本：`v0.1.3` Windows Pre-release

本文档是 Mimodex 当前阶段、最新构建和剩余工作的权威入口。架构决策、实现说明和
历史验证证据保留各自职责；当其他文档中的“当前状态”与本文冲突时，以本文为准。

## 1. 当前结论

Mimodex 已经完成从 MiMo Provider Spike、Codex Runtime Adapter、Tauri sidecar 到
React 桌面端的首轮端到端实现。当前安装包可以配置 MiMo 凭据和端点、选择真实本地
项目、创建与恢复线程、流式对话、执行 Agent 工具、处理审批、查看 Git 文件变更摘要，并在
右侧活动面板查看持久化 Runtime 审计记录。

当前阶段不是继续扩展功能范围，而是使用真实 Windows 11 安装环境完成私测准入验收、
修复阻断缺陷，并补齐正式发布前的安全和交付控制。

## 2. 最新权威发布

| 项目 | 结果 |
| --- | --- |
| Windows Release 构建提交 | `v0.1.3` 标签提交 |
| Windows Release | [Windows Release #27599562104](https://github.com/MorganArthur/mimodex/actions/runs/27599562104) |
| GitHub Pre-release | [Mimodex v0.1.3](https://github.com/MorganArthur/mimodex/releases/tag/v0.1.3) |
| 安装包 | `Mimodex_0.1.3_x64-setup.exe`，未签名 NSIS x64 |
| 安装包大小 | `57.88 MiB` |
| SHA256 | `4D1DE25C08E631E290AA666FEA934773723241685C5085846C22CB0254A43337` |

Windows Release 已通过版本标签校验、TypeScript、React、Tauri Rust 格式与编译检查、SQLite
持久化 Rust 单测、Runtime sidecar 编译、Runtime 初始化握手、NSIS 打包和安装包
体积预算检查，并将安装包与 SHA256 文件发布到长期可下载的 GitHub Pre-release。

## 3. 已实现范围

### MiMo 与 Runtime

- 原生 MiMo Chat Completions Adapter；
- `mimo-v2.5` 默认模型与 `mimo-v2.5-pro` 高级模型；
- 文本、工具调用和用量流式事件；
- 简单对话快速路径与增量绘制；
- 工具循环、审批、拒绝、失败、取消与 Runtime 线程恢复；
- 自定义可信 Base URL 和 Provider 连接诊断。

### 桌面端

- Tauri 2、React、TypeScript 与真实 Runtime sidecar；
- Windows 凭据管理器中的 API Key 保存、替换与删除流程；
- Codex 风格对话布局：右侧用户气泡、左侧 AI 正文与可展开工具活动；
- AI 回复安全渲染 GitHub Flavored Markdown，包括标题、列表、代码、表格与链接；
- 轮次真实处理时间展示，并随线程投影持久化；
- 真实项目文件夹选择、持久化、Git 状态与自动刷新；
- 新增、修改、删除、已暂存、未暂存和未跟踪文件变更摘要；
- 文件级新增与删除行数展示；
- 线程创建、恢复、继续对话、归档、恢复归档和本地索引移除；
- SQLite 事件账本、查询投影、崩溃中断标记与旧 JSON 一次性迁移；
- Runtime 原始协议事件持久化，以及右侧活动审计面板；
- Token 用量展示、完全访问警告和审批边界详情。

### 交付

- 本地无需安装 Rust；
- Desktop CI、Runtime CI、Provider Spike CI、Windows Preview 与 Windows Release 工作流；
- 未签名 NSIS 安装包、SHA256 文件和 `120 MiB` 体积硬上限。
- `v*` 标签触发的未签名 GitHub Pre-release，可长期下载版本安装包。

## 4. 当前未完成

### 私测准入阻断项

1. 按 `WINDOWS_11_PRIVATE_BETA_ACCEPTANCE.md` 完成真实安装、重启、卸载和 Agent 闭环验收。
2. 使用真实 Windows 凭据管理器完成保存、替换、删除和真实 MiMo 任务验收。
3. 验证只读、工作区写入、完全访问、命令联网和越界审批的真实 Windows 强制边界。
4. 验证异常退出、待审批和工具副作用状态不确定时的恢复行为。
5. 补齐 API Key、日志和错误信息的自动脱敏测试。
6. 验证 `AGENTS.md` 项目指导、限流、超时、上下文超限和 Provider 服务不可用路径。
7. 建立动作与文件变更的明确关联，满足 `REV-003` 可追溯要求。

### 正式发布前

- 自动化安装、启动、Runtime 握手和卸载冒烟测试；
- Windows 代码签名与受保护的稳定 Release 流程；
- 安装后目录体积检查、许可证清单和发布说明；
- 明确日志保留、隐私说明和可选遥测策略。

### Beta 后 P1

- 移除项目、线程重命名与置顶；
- Git 暂存与提交用户动作；
- 撤销选定 Agent 改动、在 Diff 上提交反馈；
- 集成终端与终端上下文；
- 非敏感设置导入导出；
- 长上下文压缩与完整原始事件 reducer。

## 5. 当前工作顺序

1. 使用最新 Artifact 执行 Windows 11 私测验收清单；
2. 记录并修复真实安装环境中的阻断问题；
3. 补齐 P0 安全、恢复和动作追溯自动化测试；
4. 完成发布冒烟、签名和 Release 工作流；
5. 私测准入通过后再进入 P1 功能开发。

## 6. 文档维护规则

- 本文记录当前阶段和最新权威构建；
- `docs/validation/evidence` 是历史证据，不随当前进度改写；
- ADR 记录决策及其当前实施状态，不作为任务清单；
- 实现文档描述模块边界、已实现范围和仍存在的限制；
- 每次阶段性提交后，应先更新本文，再更新受影响的专项文档。
