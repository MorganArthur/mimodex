# Mimodex

[![Desktop CI](https://github.com/MorganArthur/mimodex/actions/workflows/desktop-ci.yml/badge.svg)](https://github.com/MorganArthur/mimodex/actions/workflows/desktop-ci.yml)
[![Runtime CI](https://github.com/MorganArthur/mimodex/actions/workflows/runtime-ci.yml/badge.svg)](https://github.com/MorganArthur/mimodex/actions/workflows/runtime-ci.yml)
[![Windows Release](https://github.com/MorganArthur/mimodex/actions/workflows/windows-release.yml/badge.svg)](https://github.com/MorganArthur/mimodex/actions/workflows/windows-release.yml)

Mimodex 是一款由小米 `mimo-v2.5` 与 `mimo-v2.5-pro` API 驱动的本地优先桌面编程 Agent。
它参考 Codex 桌面端的工作方式，把对话线程、项目文件、Git 变更、工具执行和审批记录集中到一个
Windows 桌面应用中，让你可以把本地代码任务交给 MiMo，并在每一步保留可审阅的痕迹。

当前版本是 `v0.1.5` Windows Pre-release。它已经完成桌面 MVP 的端到端闭环，但仍是未签名的私测版本。

## 功能特性

- 本地项目工作区：每个线程绑定一个本地文件夹，支持 Git 项目和非 Git 文件夹。
- MiMo 原生接入：默认使用 `mimo-v2.5`，高级模型选择中提供 `mimo-v2.5-pro`。
- 真实 Agent 流程：支持查看代码、编辑文件、运行命令、处理工具调用和继续历史线程。
- 权限边界：提供只读、工作区写入、完全访问三种模式，高风险操作需要审批。
- 流式对话：AI 回复、推理摘要、命令输出和工具活动会实时进入对话区。
- Git 变更摘要：右侧面板显示当前项目的文件级变更数量、暂存状态和新增/删除行数。
- 本地持久化：线程索引、桌面投影、Runtime 原始协议事件和设置持久化在本机。
- 凭据保护：MiMo API Key 存入 Windows 凭据管理器，不写入普通配置文件。
- 自定义端点：支持配置可信 MiMo API Base URL，并提供连接诊断。
- Windows CI 发布：本地无需安装 Rust，Windows 安装包由 GitHub Actions 构建。

## 快速开始

### 1. 下载

从 GitHub Release 下载最新 Windows 安装包：

- [Mimodex v0.1.5 Windows Pre-release](https://github.com/MorganArthur/mimodex/releases/tag/v0.1.5)
- 安装包：`Mimodex_0.1.5_x64-setup.exe`
- 大小与 SHA256：以 GitHub Release 附件说明为准

当前安装包未代码签名，Windows 可能显示 SmartScreen 或未知发布者提示。私测阶段请只从本仓库 Release 下载。

### 2. 安装

运行 `Mimodex_0.1.5_x64-setup.exe`，按安装器提示完成安装。

首版目标平台：

- Windows 11 x64
- 本地无需安装 Rust、Cargo、MSVC 或 Node.js
- 使用真实 MiMo API 时需要可用的网络连接和 API Key

### 3. 配置 MiMo

首次启动后，按应用内引导完成配置：

1. 打开设置或首次连接引导。
2. 输入 MiMo API Key。
3. 选择官方端点，或填写你信任的自定义 Base URL。
4. 点击诊断，确认认证、端点和模型请求可用。
5. 保存后，API Key 会进入 Windows 凭据管理器。

### 4. 添加项目并开始任务

1. 点击左侧项目区域的添加按钮，选择一个本地项目文件夹。
2. 在底部输入框描述任务，例如“检查这个项目的测试失败原因”。
3. 选择权限模式：
   - `只读`：只允许检查项目，不修改文件。
   - `工作区写入`：允许修改当前项目，越界操作需要审批。
   - `完全访问`：允许访问项目外内容，启用前会显示高风险确认。
4. 选择模型，默认是 `mimo-v2.5`。
5. 按 Enter 或点击开始任务。
6. 在对话区查看 MiMo 回复和工具活动，在右侧查看文件变更摘要。

## 常见使用场景

- 让 MiMo 阅读项目结构并解释模块关系。
- 定位测试失败原因并提出修复方案。
- 让 Agent 修改一个小功能，然后审阅右侧 Git 变更。
- 运行命令前查看审批原因、工作目录、网络需求和权限边界。
- 在多个线程之间切换，让不同任务并行推进。
- 从历史线程恢复上下文，继续之前的开发任务。

## 模型与上下文

Mimodex 当前内置 MiMo V2.5 系列模型目录：

| 模型 | 展示位置 | 用途 |
| --- | --- | --- |
| `mimo-v2.5` | 默认模型 | 日常编程任务、问答、代码检查与小型修改 |
| `mimo-v2.5-pro` | 高级模型选择 | 更复杂的推理、规划和代码任务 |

Runtime 为 MiMo V2.5 系列显式声明 `1,000,000` token 上下文窗口。右侧 Runtime 卡片中的“上下文占用”
展示的是当前线程已用 token 与模型容量的比例，例如 `8,568 / 1,000,000 (<1%)`。

## 本地开发

本仓库是 Node.js workspace。常用命令：

```powershell
npm install
npm run check
npm test
npm run build
npm run verify
```

各 workspace：

```powershell
npm run check --workspace @mimodex/desktop
npm test --workspace @mimodex/desktop
npm test --workspace @mimodex/desktop-core
npm test --workspace @mimodex/runtime-client
```

### 开发约束

- 本地主要开发 TypeScript、React、协议客户端、桌面服务和文档。
- 本地默认不安装 Rust 工具链，也不要求本地打 Windows 安装包。
- Runtime 原生代码通过 `runtime/patches` 补丁队列维护。
- GitHub Actions 是 Rust 验证、Tauri 原生构建和 Windows 安装包的权威环境。
- 涉及 Runtime patch 的提交，应至少验证补丁能应用到锁定上游 commit。

## 仓库结构

```text
.
├── apps/
│   └── desktop/              # Tauri 2 + React 桌面应用
├── packages/
│   ├── desktop-core/         # 桌面会话状态、线程投影、审批和 token 逻辑
│   └── runtime-client/       # Runtime JSON-RPC / NDJSON 客户端
├── runtime/
│   ├── patches/              # 基于 Codex Rust Runtime 的 Mimodex 补丁队列
│   └── scripts/              # 补丁应用与 CI 辅助脚本
├── spikes/
│   ├── mimo-provider/        # MiMo Provider 技术验证工程
│   └── codex-runtime/        # Codex Runtime 上游锁定工作区
├── docs/                     # 产品、架构、实现、验证和交付文档
└── .github/workflows/        # CI、Preview 和 Release 工作流
```

## 发布

Mimodex 使用 CI-only 原生构建流程：

1. 更新版本号和文档。
2. 提交并打 `v*` 标签。
3. GitHub Actions 检出锁定的 Codex 上游 commit。
4. 按 `runtime/patches/series` 应用 Mimodex Runtime 补丁。
5. 执行 TypeScript、React、Tauri Rust、SQLite 单测和 Runtime 初始化握手。
6. 构建未签名 Windows NSIS 安装包。
7. 生成 SHA256 并发布到 GitHub Pre-release。

当前 Release 工作流：

- [Windows Release](https://github.com/MorganArthur/mimodex/actions/workflows/windows-release.yml)
- [Mimodex v0.1.5](https://github.com/MorganArthur/mimodex/releases/tag/v0.1.5)

稳定公开发布前仍需接入 Windows 代码签名和自动化安装/卸载冒烟测试。

## 安全与隐私

- 项目文件、线程索引、执行记录和设置默认保存在本地。
- API Key 使用 Windows 凭据管理器保存。
- 自定义端点会接收 API Key 和任务上下文，请只配置你信任的服务。
- 完全访问模式可能让 Agent 访问项目外文件，启用前请确认风险。
- 未签名安装包只适合私测，不建议作为正式公开发行版分发。

## 文档

- [当前项目状态](docs/CURRENT_STATUS.md)
- [产品需求文档](docs/product/PRD.md)
- [架构总览](docs/architecture/README.md)
- [Codex Runtime 接入盘点](docs/architecture/CODEX_RUNTIME_INVENTORY.md)
- [Windows 11 CI 构建与发布方案](docs/delivery/WINDOWS_CI_RELEASE.md)
- [Windows 11 私测验收清单](docs/validation/WINDOWS_11_PRIVATE_BETA_ACCEPTANCE.md)
- [MiMo Provider 技术验证清单](docs/validation/MIMO_PROVIDER_SPIKE.md)
- [MiMo Provider Spike 当前状态](docs/validation/MIMO_PROVIDER_SPIKE_STATUS.md)

架构决策记录：

- [ADR-0001：采用 Tauri 桌面外壳与 Rust Agent Core](docs/architecture/decisions/ADR-0001-tauri-rust-agent-core.md)
- [ADR-0002：基于 Codex App Server 分支开发 Agent Runtime](docs/architecture/decisions/ADR-0002-fork-codex-app-server.md)
- [ADR-0003：实现原生 MiMo Chat Completions Provider](docs/architecture/decisions/ADR-0003-native-mimo-provider.md)
- [ADR-0004：分离沙箱强制边界与审批策略](docs/architecture/decisions/ADR-0004-sandbox-and-approvals.md)
- [ADR-0005：在本地持久化可重放的 Agent 线程](docs/architecture/decisions/ADR-0005-local-thread-persistence.md)
- [ADR-0006：本地只编辑源码，原生构建与 Windows 打包由 GitHub Actions 完成](docs/architecture/decisions/ADR-0006-ci-only-native-builds.md)

## 当前状态

`v0.1.5` 已完成桌面 MVP 功能闭环，当前重点是 Windows 11 私测验收、阻断缺陷修复、
安全脱敏、动作与变更关联、发布冒烟和代码签名准备。最新状态以
[docs/CURRENT_STATUS.md](docs/CURRENT_STATUS.md) 为准。

## License

当前仓库尚未提供正式 LICENSE 文件。公开发布或接受外部贡献前，应先明确许可证策略。
