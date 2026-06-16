# Windows 11 CI 构建与发布方案

- 状态：CI-only 原生构建、Windows Preview 与未签名 GitHub Pre-release 流水线已建立
- 最后更新：2026-06-13
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
| 当前 GitHub Pre-release | 未签名安装包、SHA-256 清单、GitHub Release |
| 后续正式稳定发布 | 签名安装包、SHA-256 清单、GitHub Release |
| 安装包优化目标 | Windows x64 NSIS `setup.exe` 不超过 `100 MiB` |
| 安装包发布硬上限 | Windows x64 NSIS `setup.exe` 不超过 `120 MiB` |
| 安装后文件硬上限 | Windows x64 应用文件总量不超过 `350 MiB` |
| ARM64 | 首版不承诺，x64 稳定后再增加 |

选择 NSIS 作为首版主安装包，是因为 Tauri 原生支持且适合常规桌面安装流程。MSI
只能在 Windows 上构建，并额外依赖 WiX/VBSCRIPT 环境，作为后续可选产物更稳妥。

## 3. Workflow 状态

| Workflow | 触发 | 作用 |
| --- | --- | --- |
| `provider-spike-ci.yml` | PR、main、手动 | 验证当前 TypeScript Provider Spike，已建立 |
| `runtime-ci.yml` | PR、main、手动 | 拉取锁定上游、应用补丁，执行 Rust 格式、检查、单测和 Windows Runtime 编译；已建立 |
| `desktop-ci.yml` | PR、main、手动 | 快速执行桌面 TypeScript 检查、离线测试与 React 生产构建 |
| `windows-preview.yml` | PR、main、手动 | 构建 Runtime、Tauri 与未签名 NSIS 安装包，检查体积并上传 Actions Artifact |
| `windows-release.yml` | `v*` 版本标签、手动指定既有标签 | 校验标签与应用版本，构建未签名 NSIS 安装包并发布 GitHub Pre-release |
| `mimo-live-probe.yml` | 手动、受保护环境 | 待实现：使用预算受限凭据执行真实 API 兼容性验证 |

Runtime CI 已基于固定上游 commit 与补丁队列建立。桌面 Workflow 已接入 Runtime
客户端、桌面应用服务、React 交互测试与生产构建。较慢的原生编译与安装包任务独立
放入 `windows-preview.yml`，避免拖慢日常 TypeScript 反馈。当前 Windows Preview
会执行桌面验证、Tauri Rust 格式与编译检查、SQLite Rust 单测、Runtime sidecar
编译与初始化握手、NSIS 打包、体积检查、SHA256 生成和 Artifact 上传。

`windows-release.yml` 复用同一套权威构建链路，并额外校验版本标签、生成长期可下载的
GitHub Pre-release 和 SHA256 文件。工作流支持重复手动构建既有标签；重复执行会覆盖
对应 Release 的安装包和说明。当前安装包尚未签名，因此 Release 明确标记为预发布版。

最新成功构建为
[Windows Preview #27449796215](https://github.com/MorganArthur/mimodex/actions/runs/27449796215)，
安装包大小 `57.76 MiB`；对应
[Desktop CI #27449796224](https://github.com/MorganArthur/mimodex/actions/runs/27449796224)
同样成功。详细产物信息见：[Mimodex 当前项目状态](../CURRENT_STATUS.md)。

当前长期可下载版本为
[Mimodex v0.1.4 Windows Pre-release](https://github.com/MorganArthur/mimodex/releases/tag/v0.1.4)，
由 `v0.1.4` 标签触发
[Windows Release #27604579174](https://github.com/MorganArthur/mimodex/actions/runs/27604579174)
构建并发布。安装包大小 `57.91 MiB`，SHA256 为
`AA339BA0C2927FAA628FD1089995D41A5360DB88CEFB0BA596EC0B380679B31F`，当前未进行代码签名。

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
5. 对外稳定发布前，安装包完成代码签名并通过签名校验；当前未签名版本只能标记为
   GitHub Pre-release。
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
- 后续接入 Windows 签名时，使用独立受保护 Environment；稳定发布前需要人工批准。
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

## 10. 当前交付缺口

- 尚未配置 Windows 代码签名证书或远程签名服务；
- 尚未自动验证安装后目录体积；
- 尚未自动执行安装、启动、Runtime 握手和卸载冒烟；
- 尚未自动生成许可证清单和基于提交历史的完整发布说明。
