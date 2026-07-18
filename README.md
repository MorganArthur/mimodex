# Mimodex

[![Desktop CI](https://github.com/MorganArthur/mimodex/actions/workflows/desktop-ci.yml/badge.svg)](https://github.com/MorganArthur/mimodex/actions/workflows/desktop-ci.yml)
[![Runtime CI](https://github.com/MorganArthur/mimodex/actions/workflows/runtime-ci.yml/badge.svg)](https://github.com/MorganArthur/mimodex/actions/workflows/runtime-ci.yml)
[![Windows Release](https://github.com/MorganArthur/mimodex/actions/workflows/windows-release.yml/badge.svg)](https://github.com/MorganArthur/mimodex/actions/workflows/windows-release.yml)

Mimodex 是一款由小米 `mimo-v2.5` 与 `mimo-v2.5-pro` API 驱动的本地优先桌面编程 Agent。
它参考 Codex 桌面端的工作方式，把对话线程、项目文件、Git 变更、工具执行和审批记录集中到一个
Windows 桌面应用中，让你可以把本地代码任务交给 MiMo，并在每一步保留可审阅的痕迹。

当前版本是 `v0.3.4` Windows 版本。它已经完成桌面 MVP 的端到端闭环，并新增了自动化任务、
插件系统、集成终端等能力，但仍是未签名的私测版本。

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
- **自动化任务**：支持配置 manual/hourly/daily/weekly 频率的自动化任务，定时执行编码任务。
- **插件系统**：支持企业微信、飞书、钉钉、微信通知和通用 Webhook 插件。
- **集成终端**：嵌入式 PowerShell 终端，可在项目目录直接执行命令。
- **分支切换**：可查看项目分支列表并切换当前分支。

## 快速开始

### 1. 下载

从 GitHub Release 下载最新 Windows 安装包：

- [Mimodex v0.3.4 Windows 版本](https://github.com/MorganArthur/mimodex/releases/tag/v0.3.4)
- 安装包：`Mimodex_0.3.4_x64-setup.exe`
- 大小与 SHA256：以 GitHub Release 附件说明为准

当前安装包未代码签名，Windows 可能显示 SmartScreen 或未知发布者提示。私测阶段请只从本仓库 Release 下载。

### 2. 安装

运行 `Mimodex_0.3.4_x64-setup.exe`，按安装器提示完成安装。

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
2. 在底部输入框描述任务，例如"检查这个项目的测试失败原因"。
3. 选择权限模式：
   - `只读`：只允许检查项目，不修改文件。
   - `工作区写入`：允许修改当前项目，越界操作需要审批。
   - `完全访问`：允许访问项目外内容，启用前会显示高风险确认。
4. 选择模型，默认是 `mimo-v2.5`。
5. 按 Enter 或点击开始任务。
6. 在对话区查看 MiMo 回复和工具活动，在右侧查看文件变更摘要。

### 5. 使用自动化任务

1. 进入自动化面板，点击"新建自动化"。
2. 选择关联项目、模型、权限模式和执行频率。
3. 输入自动化任务的提示词。
4. 保存后，任务会按设定频率自动执行，也可随时手动触发。

### 6. 配置插件

1. 进入设置中的插件面板，点击"新建插件"。
2. 选择插件类型（企业微信、飞书、钉钉等）。
3. 填写 Webhook URL 和可选的密钥。
4. 保存后可发送测试消息验证配置。

## 常见使用场景

- 让 MiMo 阅读项目结构并解释模块关系。
- 定位测试失败原因并提出修复方案。
- 让 Agent 修改一个小功能，然后审阅右侧 Git 变更。
- 运行命令前查看审批原因、工作目录、网络需求和权限边界。
- 在多个线程之间切换，让不同任务并行推进。
- 从历史线程恢复上下文，继续之前的开发任务。
- 配置定时自动化任务，让 Agent 定期执行代码检查或报告生成。
- 通过 Webhook 插件将 Agent 执行结果推送到协作工具。
- 在集成终端中手动执行命令，验证 Agent 的操作结果。

## 模型与上下文

Mimodex 使用 MiMo Chat Completions API，支持以下模型：

| 模型 | 上下文窗口 | 特点 |
|-----|-----------|------|
| `mimo-v2.5` | 1M tokens | 默认模型，平衡速度与质量 |
| `mimo-v2.5-pro` | 1M tokens | 高级模型，复杂任务优先 |

模型选择在线程级别，不同线程可使用不同模型。线程创建后模型不可更改。

## 开发

本项目使用 pnpm workspace 管理多包结构：

```bash
# 安装依赖
pnpm install

# 开发桌面端（需要 Rust 工具链）
cd apps/desktop
pnpm tauri dev

# 运行测试
pnpm test

# 构建 Windows 安装包（CI 环境）
pnpm tauri:build
```

详见各目录下的实现说明文档。

## 文档索引

- [产品需求文档](docs/product/PRD.md)
- [当前项目状态](docs/CURRENT_STATUS.md)
- [架构总览与决策记录](docs/architecture/)
- [实现说明](docs/implementation/)
- [验证证据](docs/validation/)

## 许可

MIT License
