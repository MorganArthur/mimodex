# 桌面 Runtime 客户端接入计划

- 状态：TypeScript 协议切片与 Tauri sidecar adapter 已通过 Windows Preview CI
- 最后更新：2026-06-11
- 对应包：`packages/runtime-client`
- 首次远程验证：[Desktop CI #27252463625](https://github.com/MorganArthur/mimodex/actions/runs/27252463625)

## 1. 目标

桌面端需要通过 Codex app-server 的标准输入输出控制 Mimodex Runtime，同时避免 React
界面直接依赖进程、JSON-RPC 或 MiMo Provider 的内部字段。

首个切片建立一个纯 TypeScript Runtime 客户端，负责：

- 解码按行传输的 JSON 消息；
- 关联 JSON-RPC 请求与乱序响应；
- 转发通知、标准错误和进程退出事件；
- 暴露 Runtime 发起的审批等反向请求；
- 完成 `initialize` / `initialized` 握手；
- 提供首批线程和轮次 API；
- 为后续 Tauri sidecar 适配提供稳定接口。

## 2. 分层边界

| 层级 | 当前职责 | 不承担的职责 |
| --- | --- | --- |
| React 界面 | 展示线程、轮次、审批和活动记录 | 不解析 JSON-RPC，不管理 Runtime 进程 |
| 桌面应用服务 | 将界面操作映射为 Runtime 客户端调用 | 不暴露 MiMo Provider 请求结构 |
| `@mimodex/runtime-client` | 协议、握手、事件流和进程端口抽象 | 不依赖 Tauri，不持有 API Key |
| Tauri sidecar 适配器 | 启动、写入和终止 Runtime 子进程 | 不包含业务协议 |
| Mimodex Runtime | Agent 循环、工具调用、审批和持久化 | 不直接操作桌面界面 |

`RuntimeProcessPort` 是 TypeScript 客户端与未来 Tauri sidecar 之间的唯一进程边界。
因此当前包可以在本地 Node.js 环境完整验证，不需要安装 Rust。

## 3. 协议与生命周期

app-server 使用标准输入输出传输，每行是一条 JSON 消息。客户端启动顺序固定为：

1. 启动 Runtime transport 并注册标准输出、标准错误和退出监听器。
2. 发送 `initialize` 请求并等待响应。
3. 发送 `initialized` 通知。
4. 开放线程和轮次业务调用。
5. 关闭时拒绝待处理请求并终止所拥有的 Runtime 进程。

Runtime 退出时，客户端会先处理标准输出中最后一条未带换行的完整 JSON 消息，再拒绝
仍未完成的请求。传输启动失败不会把客户端错误地标记为已启动。

## 4. 首批桌面 API

| 客户端方法 | Runtime 方法 | 用途 |
| --- | --- | --- |
| `startThread` | `thread/start` | 新建项目线程 |
| `resumeThread` | `thread/resume` | 恢复已有线程 |
| `startTurn` | `turn/start` | 提交用户输入并开始 Agent 轮次 |
| `interruptTurn` | `turn/interrupt` | 中断当前轮次 |
| `onNotification` | Runtime 通知 | 接收线程、轮次和工具生命周期事件 |
| `onServerRequest` | Runtime 反向请求 | 处理命令执行审批等交互 |
| `respond` / `respondError` | JSON-RPC 响应 | 回复 Runtime 反向请求 |

当前类型只定义桌面端首个切片实际需要的稳定字段。完整生成协议和实验字段在真正需要
前不进入桌面公共接口，MiMo 请求格式也不会泄漏到该层。

## 5. 错误处理

- JSON-RPC 错误响应映射为包含 `code` 和 `data` 的结构化异常。
- 请求超时会清除关联状态并返回超时异常。
- Runtime 退出或客户端关闭会拒绝全部待处理请求。
- 无效 JSON、未知响应 ID 和非法消息形状通过协议错误事件报告。
- 标准错误流独立转发，避免污染标准输出协议。

## 6. 当前验证

`npm run verify` 在本地和 `desktop-ci.yml` 中执行严格 TypeScript 检查与离线测试。
当前覆盖：

- Unicode 字节分块、CRLF/LF 和末尾无换行 NDJSON；
- 乱序响应、通知、反向请求和结构化错误；
- 请求超时前后的连接清理基础行为；
- Runtime 退出与传输启动失败恢复；
- 完整初始化握手及首批线程、轮次 API 映射；
- 进程 transport 的按行写入与监听器释放。

## 7. Tauri 接入进展

桌面应用服务和首个 React 交互壳已经实现，详情见
[桌面应用服务与交互壳实现说明](DESKTOP_APP_SHELL_PLAN.md)。Tauri 桌面工程已经实现
`RuntimeProcessPort`：

1. 由 Tauri 启动打包后的 Mimodex Runtime sidecar。
2. 将 sidecar 标准输出、标准错误和退出事件适配到 Runtime 客户端。
3. 原生桌面使用真实 Runtime，普通浏览器继续使用可替换的演示连接。
4. 由 GitHub Actions 执行 Tauri Windows 编译并上传技术预览安装包。
