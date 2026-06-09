# ADR-0006：本地只编辑源码，原生构建与 Windows 打包由 GitHub Actions 完成

- 状态：已接受
- 日期：2026-06-09

## 背景

Mimodex 的桌面外壳和 Agent Runtime 使用 Tauri 与 Rust，但当前本地开发环境不安装
Rust、Cargo、MSVC Build Tools 或 Tauri 原生打包依赖。开发者希望本地只进行源码
编辑、Node.js 验证和 Git 提交，原生编译、测试及 Windows 11 安装包构建统一交给
GitHub Actions。

GitHub 托管的 Windows Runner 可以为每个任务提供全新的 Windows 虚拟机。Tauri
支持在 Windows 上通过 `tauri build` 生成 NSIS `setup.exe` 或 MSI 安装包。

## 决策

采用 CI-only 原生构建工作流：

- 本地允许在未安装 Rust 的情况下编辑 Rust、TypeScript、React 和配置文件；
- 本地执行可用的 Node.js 类型检查、单元测试和文档检查；
- Rust 格式检查、编译、单元测试、Windows 沙箱测试和 Tauri 打包以 GitHub Actions
  结果为权威；
- PR 未通过必需的 GitHub Actions 检查不得合并；
- Windows 首发目标为 `x86_64-pc-windows-msvc`，由固定的 `windows-2025` Runner
  构建；
- 首版优先产出 NSIS `setup.exe`，需要企业部署时再同时发布 MSI；
- 普通提交只产出未签名构建 Artifact，正式版本通过受保护的 GitHub Environment
  使用签名凭据并发布 GitHub Release；
- 默认 CI 不接收 `MIMO_API_KEY`，真实 API 探针必须使用独立、手动触发且受保护的
  Workflow。

## CI 分层

### PR 快速验证

- TypeScript 类型检查和单元测试；
- Rust `cargo fmt --check`、目标 crate 的 `cargo check` 与单元测试；
- Windows x64 Runtime 编译；
- 不生成正式安装包，不使用发布凭据。

### 主分支构建

- 完整 Windows x64 Runtime 与 Tauri 构建；
- 生成未签名 NSIS 安装包；
- 上传安装包、测试报告、Cargo timing 和必要诊断 Artifact；
- 使用独立 Windows 任务执行安装、启动和卸载冒烟测试。

### 标签发布

- 仅对版本标签运行；
- 在受保护的 `windows-release` Environment 中执行；
- 构建、签名并校验安装包；
- 生成 SHA-256 清单；
- 上传 GitHub Release；
- 发布任务不得访问 MiMo 用户凭据。

## 决策理由

- 避免在本地安装和维护大型 Rust、MSVC 与 Tauri 工具链；
- 所有原生构建使用可审计、可重复的 CI 环境；
- Windows 安装包、签名和发布凭据集中在受保护环境；
- 与 Codex 上游已有的远程 Windows Rust 构建方式相符。

## 影响

### 正面影响

- 本地环境更轻，开发者只需 Node.js、Git 和编辑工具；
- 构建与发布过程集中且可追踪；
- 安装包不会因个人机器配置不同而产生差异；
- 签名凭据不需要进入本地开发机器。

### 负面影响

- Rust 编译错误、链接错误和原生测试失败只能在推送后发现；
- 修改 Rust 时反馈周期变长，提交次数和 Actions 用量会上升；
- 无法在本地直接运行或调试完整桌面端；
- GitHub 托管 Runner 的磁盘和执行时间可能不足以承载完整 Codex + Tauri 构建，
  届时需要优化缓存、拆分任务或使用更大的 Runner。

## 强制控制

- Actions 必须固定 Runner 标签、Rust 工具链版本和第三方 Action commit SHA。
- 分支保护必须要求 Provider、Runtime Windows 和桌面构建检查通过。
- CI 日志和 Artifact 不得包含 API 凭据、用户代码或未脱敏 Provider 内容。
- 发布签名密钥只能存放在 GitHub Environment Secrets 或外部签名服务中。
- 未签名构建只能作为内部测试 Artifact，不得标记为正式发布。
- 每个失败的原生构建必须能从日志或上传的诊断 Artifact 中定位。

## 重新评估条件

出现以下情况时，重新评估是否需要本地 Rust 工具链或远程开发环境：

- CI 反馈时间持续超过可接受范围；
- Windows 原生问题无法通过日志和 Artifact 定位；
- 需要高频交互调试 Windows 沙箱、进程或 Tauri 插件；
- GitHub Actions 成本高于维护专用构建机或远程开发机。

## 参考

- Tauri GitHub Actions 流水线：
  https://v2.tauri.app/distribute/pipelines/github/
- Tauri Windows 安装包：
  https://v2.tauri.app/distribute/windows-installer/
- Tauri Windows 签名：
  https://v2.tauri.app/distribute/sign/windows/
- GitHub 托管 Runner：
  https://docs.github.com/actions/reference/runners/github-hosted-runners
