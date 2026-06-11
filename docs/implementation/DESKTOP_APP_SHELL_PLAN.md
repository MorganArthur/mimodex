# 桌面应用服务与交互壳实现说明

- 状态：React 交互切片、真实 Tauri sidecar adapter 与 Windows 安装包已通过 CI
- 最后更新：2026-06-11
- 对应目录：`apps/desktop`、`packages/desktop-core`
- 首次远程验证：[Desktop CI #27253481256](https://github.com/MorganArthur/mimodex/actions/runs/27253481256)
- 首次原生安装包：[Windows Preview #27319183630](https://github.com/MorganArthur/mimodex/actions/runs/27319183630)

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
- 真实本地项目文件夹选择、持久化、Git 摘要与切换。

## 2. 分层设计

| 模块 | 职责 |
| --- | --- |
| `@mimodex/runtime-client` | app-server JSON-RPC、握手、进程 transport 边界 |
| `@mimodex/desktop-core` | 将 Runtime 事件投影成稳定桌面会话状态 |
| `@mimodex/desktop` | React 界面、交互和视觉展示 |
| `DemoRuntimeClient` | 本地界面开发使用的可替换演示连接 |
| Tauri sidecar adapter | 在原生桌面环境启动真实 Runtime，并实现现有 `RuntimeClientPort` |

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

项目列表不再由界面硬编码。Tauri 后端在应用数据目录保存非敏感项目摘要，React
通过项目服务读取和切换当前项目。新任务使用当前项目的真实路径作为 Runtime 工作
目录；项目文件夹不可用时禁止提交。详细边界见 `PROJECT_MANAGEMENT.md`。

## 4. 演示连接边界

当前 React 入口会根据运行环境选择连接：普通浏览器使用 `DemoRuntimeClient`，Tauri
桌面环境使用真实 Runtime sidecar。演示连接用于在没有本地 Rust 工具链和 Runtime
sidecar 的条件下验证完整桌面交互，它会模拟：

1. Runtime 初始化与线程创建；
2. 推理和命令生命周期事件；
3. 命令审批反向请求；
4. 批准或拒绝后的后续活动；
5. Diff 更新、完成和中断。

演示连接不是生产 Runtime，也不会访问项目文件或 MiMo API。真实 Tauri adapter 与
它实现同一个 `RuntimeClientPort`，因此 React 状态模型不需要感知进程或 JSON-RPC
传输差异。

## 5. 本地验证

根目录 `npm run verify` 当前执行：

1. 所有工作区严格 TypeScript 检查；
2. Runtime 客户端、桌面应用服务和 React 交互测试；
3. React/Vite 生产构建。

浏览器验收已覆盖默认模型、高级模型、项目添加与切换、建议任务、任务提交、流式
推理、命令审批、停止状态、完成状态和 Diff 更新，浏览器控制台无错误或警告。

## 6. 当前原生接入

本阶段已完成：

1. 最小 Tauri 2 原生工程和受限 shell 权限；
2. `RuntimeProcessPort` 的 Tauri sidecar adapter；
3. 浏览器演示连接与原生真实连接的运行时选择；
4. Runtime、Windows 沙箱辅助程序与 Tauri 的打包目录约定；
5. Windows NSIS 技术预览安装包工作流与体积预算检查。

Windows Preview CI 已验证原生编译、sidecar 暂存、NSIS 打包和 `120 MiB` 体积硬
上限，首个安装包为 `55.98 MiB`。下一步在真实 Windows 11 环境验收初始化、线程、
轮次、审批和中断闭环。
