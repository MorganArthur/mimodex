# Windows 11 CI 构建与发布方案

- 状态：Runtime 与桌面 TypeScript 基线流水线已建立，等待 Tauri 原生构建接入
- 最后更新：2026-06-10
- 本地开发约束：不安装 Rust、Cargo、MSVC 或 Tauri 原生构建依赖

## 1. 可行性结论

本地只实现代码并提交，由 GitHub Actions 完成 Rust 验证和 Windows 11 安装包构建，
技术上可行。Tauri 原生构建仍然需要 Rust 与 Windows 构建依赖，但这些依赖仅安装在
GitHub 托管 Runner，不要求安装在本地机器。

这是一种“CI 为权威构建环境”的开发模式，不是免除 Rust 编译验证。所有涉及 Rust
或 Tauri 的提交都必须等待 CI 通过后才能合并。

## 2. 首版目标

| 项目 | 决策 |
| --- | --- |
| 支持系统 | Windows 11 x64 |
| Rust Target | `x86_64-pc-windows-msvc` |
| Rust Toolchain | 锁定为 Codex 上游要求的 `1.95.0` |
| GitHub Runner | 固定 `windows-2025` |
| 主安装包 | NSIS `setup.exe` |
| 可选安装包 | MSI，用于后续企业部署需求 |
| 普通构建 | 未签名，仅作为 Actions Artifact |
| 正式发布 | 签名安装包、SHA-256 清单、GitHub Release |
| 安装包优化目标 | Windows x64 NSIS `setup.exe` 不超过 `100 MiB` |
| 安装包发布硬上限 | Windows x64 NSIS `setup.exe` 不超过 `120 MiB` |
| 安装后文件硬上限 | Windows x64 应用文件总量不超过 `350 MiB` |
| ARM64 | 首版不承诺，x64 稳定后再增加 |

选择 NSIS 作为首版主安装包，是因为 Tauri 原生支持且适合常规桌面安装流程。MSI
只能在 Windows 上构建，并额外依赖 WiX/VBSCRIPT 环境，作为后续可选产物更稳妥。

## 3. 计划中的 Workflow

| Workflow | 触发 | 作用 |
| --- | --- | --- |
| `provider-spike-ci.yml` | PR、main、手动 | 验证当前 TypeScript Provider Spike，已建立 |
| `runtime-ci.yml` | PR、main、手动 | 拉取锁定上游、应用补丁，执行 Rust 格式、检查、单测和 Windows Runtime 编译；已建立 |
| `desktop-ci.yml` | PR、main、手动 | 桌面 TypeScript 检查、离线测试与 React 生产构建；后续扩展 Tauri Windows 编译和安装包冒烟 |
| `windows-release.yml` | 版本标签、手动批准 | 构建、签名并发布 Windows 安装包 |
| `mimo-live-probe.yml` | 手动、受保护环境 | 使用预算受限凭据执行真实 API 兼容性验证 |

Runtime CI 已基于固定上游 commit 与补丁队列建立。桌面 Workflow 已接入 Runtime
客户端、桌面应用服务、React 交互测试与生产构建；Tauri 源码和锁文件进入仓库后，
再扩展原生编译与安装包冒烟步骤。桌面 Runtime 客户端基线已在
[Desktop CI #27252463625](https://github.com/MorganArthur/mimodex/actions/runs/27252463625)
首次通过；桌面应用服务与 React 交互壳已在
[Desktop CI #27253481256](https://github.com/MorganArthur/mimodex/actions/runs/27253481256)
通过。

## 4. PR 合并门槛

- Provider Spike 离线验证通过；
- Rust 格式检查通过；
- 受影响 Runtime crate 编译与测试通过；
- Windows x64 Runtime 构建通过；
- React 与 Tauri 构建通过；
- 不包含密钥、未脱敏报告或本地 Artifact；
- 关键架构与协议变更更新中文文档。

## 5. 发布门槛

1. 版本号与标签一致。
2. 从干净的 Git commit 构建。
3. Windows x64 Runtime 和 Tauri 安装包构建成功。
4. 安装、启动、Runtime 握手和卸载冒烟通过。
5. 安装包完成代码签名并通过签名校验。
6. 安装包不超过 `120 MiB`，安装后应用文件总量不超过 `350 MiB`。
7. 生成并发布 SHA-256 清单。
8. GitHub Release 仅包含通过校验的产物。

## 6. 体积预算

CI 构建环境包含 Rust 工具链、依赖源码、中间目标文件、测试二进制、缓存和调试信息，
临时占用可以达到数十 GiB；这些内容不得进入最终安装包。

首版完整复用 Codex App Server，不能承诺十几 MiB 的安装包。以 2026-06-09 的官方
Codex Windows x64 发布产物为参考，App Server 原始可执行文件约 `203 MiB`，压缩包
约 `69 MiB`。参考版本：
[`rust-v0.138.0`](https://github.com/openai/codex/releases/tag/rust-v0.138.0)。
Mimodex 使用以下预算控制最终体积：

- 日常优化目标：NSIS 安装包不超过 `100 MiB`；
- 发布硬上限：NSIS 安装包不超过 `120 MiB`；
- 安装后硬上限：应用目录文件总量不超过 `350 MiB`；
- 发布流水线使用 `scripts/ci/assert-size-budget.ps1` 检查安装包和安装后目录；
- 安装包只包含运行所需的桌面文件、Runtime、Windows 沙箱组件和许可证声明；
- Cargo 缓存、源码、测试、临时文件、符号归档和其他构建产物不得打包。

体积超出日常目标但未达到硬上限时，版本可以继续验证，但必须记录增长来源。超过任一
硬上限时，发布流水线必须失败。

## 7. 凭据与供应链控制

- `MIMO_API_KEY` 不进入普通 CI、构建或发布任务。
- 真实 API 探针使用独立 GitHub Environment 和预算受限凭据。
- Windows 签名使用独立 `windows-release` Environment；正式发布前需要人工批准。
- 第三方 Actions 使用完整 commit SHA 固定。
- Actions 权限默认只读，发布任务按需获得最小写权限。
- 构建 Artifact、缓存和日志不得包含用户项目、API Key 或未脱敏模型内容。

## 8. 本地开发方式

本地开发者可以：

- 编辑 Rust、TypeScript、React、Workflow 和文档；
- 运行 Node.js 类型检查与离线测试；
- 查看 Git diff 并提交；
- 根据 Actions 日志修复 Rust 编译和测试问题。

本地开发者不能在当前约束下：

- 编译或运行 Rust Runtime；
- 本地启动完整 Tauri 桌面端；
- 本地验证 Windows 沙箱和安装包；
- 在提交前确认 Rust 修改一定可编译。

因此应保持提交小而聚焦，并优先编写可由 CI 独立验证的测试。

## 9. 已知风险

- GitHub 托管 Runner 的可用磁盘有限，Codex Runtime 完整编译可能需要清理无关目标、
  拆分构建或使用更大的 Runner。
- Rust 修改的反馈周期取决于 Actions 排队与编译时间。
- 未签名安装包可能触发 Windows SmartScreen；正式对外发布前必须配置签名。
- 只有真实 Windows 11 设备上的安装与交互验收，才能覆盖所有桌面体验问题。
