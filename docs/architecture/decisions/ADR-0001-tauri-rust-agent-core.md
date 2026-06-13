# ADR-0001：采用 Tauri 桌面外壳与 Rust Agent Core

- 状态：已接受并实施
- 日期：2026-06-09

## 背景

Mimodex 需要响应迅速的跨平台桌面界面，以及能够安全管理进程、文件、Git、
流式模型请求和持久线程状态的本地 Runtime。首个平台为 Windows，之后计划
支持 macOS。

## 决策

采用：

- Tauri 2 作为桌面应用外壳；
- React 与 TypeScript 构建用户界面；
- Rust 构建本地 Agent Runtime；
- 桌面端与 Runtime 之间通过受监管子进程的 stdio 进行本地 JSON-RPC 通信。

桌面进程负责展示和操作系统外壳集成，Agent Runtime 负责全部模型与工具执行行为。

## 实施状态

截至 2026-06-13，Tauri 2、React、TypeScript、真实 Rust Runtime sidecar 和本地
JSON-RPC 客户端均已实现，并由 Windows Preview 持续构建为 NSIS 安装包。

## 决策理由

- Rust 与选定的 Codex Runtime 基础一致。
- 与常规 Electron 应用相比，Tauri 安装体积较小，暴露的 Web 攻击面更窄。
- 进程边界能够隔离 UI 崩溃和 Agent Runtime 状态，并形成清晰协议，未来可支持
  CLI 或 IDE 客户端。
- JSON-RPC 和流式通知适合事件驱动的 Agent 生命周期。

## 影响

### 正面影响

- 可以与分支后的 Agent Core 共用语言和类型。
- 可信 Runtime 策略与 UI 展示职责清晰分离。
- Runtime 未来可被其他客户端复用。
- 支持原生打包和操作系统凭据存储。

### 负面影响

- 需要同时维护 Rust、TypeScript 和生成的协议绑定。
- 必须明确处理 stdio 生命周期、崩溃恢复和版本协商。
- 需要在支持的 Windows 版本上测试 Tauri WebView 行为。

## 未采用方案

### Electron 与 Node.js Runtime

全 TypeScript 原型速度更快，但需要重新实现或额外包装更多 Rust Agent Runtime
和进程安全模型。

### UI 直接调用 MiMo API

不采用。该方案会将凭据、Provider 状态、审批和工具执行混入展示层。

### 单进程 Tauri Runtime

首版不采用。独立受监管 Runtime 能提供更清晰的故障隔离，并为非桌面客户端预留空间。
