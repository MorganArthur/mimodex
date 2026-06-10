# 桌面应用服务与交互壳实现说明

- 状态：首个 React 交互切片已实现并通过 Desktop CI
- 最后更新：2026-06-10
- 对应目录：`apps/desktop`、`packages/desktop-core`
- 首次远程验证：[Desktop CI #27253481256](https://github.com/MorganArthur/mimodex/actions/runs/27253481256)

## 1. 当前目标

这一阶段建立 Runtime 客户端之上的桌面应用服务和首个可交互界面，同时保持 React
与 Tauri、进程管理和 JSON-RPC 解耦。

当前切片覆盖：

- 项目与线程侧栏；
- 默认模型 `mimo-v2.5` 和高级模型 `mimo-v2.5-pro` 选择；
- 只读、工作区写入和完全访问模式展示；
- 任务提交、流式活动时间线和停止控制；
- 命令与文件审批卡片；
- 工作区 Diff 面板；
- Runtime 连接、线程和轮次状态展示。

## 2. 分层设计

| 模块 | 职责 |
| --- | --- |
| `@mimodex/runtime-client` | app-server JSON-RPC、握手、进程 transport 边界 |
| `@mimodex/desktop-core` | 将 Runtime 事件投影成稳定桌面会话状态 |
| `@mimodex/desktop` | React 界面、交互和视觉展示 |
| `DemoRuntimeClient` | 本地界面开发使用的可替换演示连接 |
| 后续 Tauri adapter | 启动真实 Runtime sidecar，并实现现有 `RuntimeClientPort` |

React 不解析 JSON-RPC 方法，也不直接管理子进程。桌面应用服务负责把通知和反向请求
转换为界面可消费的时间线、审批、Diff 和生命周期状态。

## 3. 桌面会话状态

`DesktopSessionController` 当前管理：

- Runtime 连接状态与平台信息；
- 当前项目、模型、线程、轮次和执行状态；
- 用户消息、助手文本、推理、命令、文件与错误时间线；
- 待处理审批及其决定；
- 当前轮次聚合 Diff。

普通 Provider 或轮次错误不会被误判为 Runtime 断开。切换项目路径时会创建新线程，
执行中的轮次也会阻止重复提交。

## 4. 演示连接边界

当前 React 入口使用 `DemoRuntimeClient`，用于在没有本地 Rust 工具链和 Runtime
sidecar 的条件下验证完整桌面交互。它会模拟：

1. Runtime 初始化与线程创建；
2. 推理和命令生命周期事件；
3. 命令审批反向请求；
4. 批准或拒绝后的后续活动；
5. Diff 更新、完成和中断。

演示连接不是生产 Runtime，也不会访问项目文件或 MiMo API。后续真实 Tauri adapter
实现相同的 `RuntimeClientPort` 后，可以在不修改 React 状态模型的情况下替换它。

## 5. 本地验证

根目录 `npm run verify` 当前执行：

1. 所有工作区严格 TypeScript 检查；
2. Runtime 客户端、桌面应用服务和 React 交互测试；
3. React/Vite 生产构建。

浏览器验收已覆盖默认模型、高级模型、建议任务、任务提交、流式推理、命令审批、
停止状态、完成状态和 Diff 更新，浏览器控制台无错误或警告。

## 6. 下一阶段

下一阶段建立真实 Tauri 桌面外壳与 sidecar 连接：

1. 添加最小 Tauri 2 原生工程和权限配置；
2. 实现 `RuntimeProcessPort` 的 Tauri sidecar adapter；
3. 在 CI 中构建 Mimodex Runtime sidecar，并由 Tauri 打包引用；
4. 用真实 app-server 验证初始化、线程、轮次、审批和中断闭环；
5. 增加 Windows 安装包构建与体积预算检查。
