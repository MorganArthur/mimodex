# Mimodex 当前项目状态

- 状态：桌面功能持续迭代中，`v0.3.4` Windows 版本已发布
- 最新 Windows Release 构建提交：`v0.3.4` 标签触发
- 最后更新：2026-07-18
- 当前版本：`v0.3.4` Windows 版本

本文档是 Mimodex 当前阶段、最新构建和剩余工作的权威入口。架构决策、实现说明和
历史验证证据保留各自职责；当其他文档中的"当前状态"与本文冲突时，以本文为准。

## 1. 当前结论

Mimodex 已经完成从 MiMo Provider Spike、Codex Runtime Adapter、Tauri sidecar 到
React 桌面端的多轮端到端实现。当前版本 v0.3.4 在 v0.1.7 基础上显著扩展了功能范围：
自动化任务（前端调度）、插件系统（Webhook 通知）、集成终端、分支切换等能力已落地。

当前阶段需要在继续扩展功能的同时，补强测试覆盖、完成私测验收、并推进代码签名与跨平台准备。

## 2. 最新权威发布

| 项目 | 结果 |
| --- | --- |
| Windows Release 构建提交 | `v0.3.4` 标签提交 |
| Windows Release | GitHub Actions 生成 |
| GitHub Release | [Mimodex v0.3.4](https://github.com/MorganArthur/mimodex/releases/tag/v0.3.4) |
| 安装包 | `Mimodex_0.3.4_x64-setup.exe`，未签名 NSIS x64 |
| 安装包大小 | 以 GitHub Release 附件说明为准 |
| SHA256 | 以 GitHub Release 附件说明为准 |

Windows Release 已通过版本标签校验、TypeScript、React、Tauri Rust 格式与编译检查、SQLite
持久化 Rust 单测、Runtime sidecar 编译、Runtime 初始化握手、NSIS 打包和安装包
体积预算检查，并将安装包与 SHA256 文件发布到长期可下载的 GitHub Release。

## 3. 已实现范围

### MiMo 与 Runtime

- 原生 MiMo Chat Completions Adapter；
- `mimo-v2.5` 默认模型与 `mimo-v2.5-pro` 高级模型；
- 文本、工具调用和用量流式事件；
- 简单对话快速路径与增量绘制；
- Codex 风格任务执行指令：先读项目、遵守 `AGENTS.md`、保护用户改动、聚焦修改并验证；
- MiMo thinking 策略：无工具简单对话继续禁用 thinking，带工具编码任务不再强制禁用 thinking；
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
- Token 用量展示、MiMo 1M 上下文窗口归一化、完全访问警告和审批边界详情；
- **v0.2.x 新增**：项目分支列表查看与切换；
- **v0.3.x 新增**：自动化任务配置与前端调度（manual/hourly/daily/weekly）；
- **v0.3.x 新增**：插件系统（企业微信、飞书、钉钉、微信通知、通用 Webhook）；
- **v0.3.x 新增**：集成终端（PowerShell 嵌入式终端会话）；
- **v0.3.x 新增**：图片附件支持。

### 交付

- 本地无需安装 Rust；
- Desktop CI、Runtime CI、Provider Spike CI、Windows Preview 与 Windows Release 工作流；
- 未签名 NSIS 安装包、SHA256 文件和 `120 MiB` 体积硬上限；
- `v*` 标签触发的 GitHub Release，可长期下载版本安装包。

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

### 后续优化方向

- 移除项目、线程重命名与置顶；
- Git 暂存与提交用户动作；
- 撤销选定 Agent 改动、在 Diff 上提交反馈；
- 终端上下文与命令历史；
- 非敏感设置导入导出；
- 长上下文压缩与完整原始事件 reducer；
- Rust 后端真实调度器（当前为前端 setInterval 调度）；
- macOS 跨平台支持。

## 5. 当前工作顺序

1. 使用最新 Artifact 执行 Windows 11 私测验收清单；
2. 记录并修复真实安装环境中的阻断问题；
3. 补齐 P0 安全、恢复和动作追溯自动化测试；
4. 完成发布冒烟、签名和 Release 工作流；
5. 私测准入通过后再进入后续功能开发。

## 6. 文档维护规则

- 本文记录当前阶段和最新权威构建；
- `docs/validation/evidence` 是历史证据，不随当前进度改写；
- ADR 记录决策及其当前实施状态，不作为任务清单；
- 实现文档描述模块边界、已实现范围和仍存在的限制；
- 每次阶段性提交后，应先更新本文，再更新受影响的专项文档。
