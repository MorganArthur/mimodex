# MiMo 流式显示与简单对话快速路径验证

## 实际事件结论

从本机安装版 `threads.sqlite3` 的 Runtime 原始协议事件确认：

- 最近轮次均持续收到 `item/agentMessage/delta`，单轮包含 `19–72` 个文本增量；
- 首字等待约为 `8.7–13.5` 秒；
- 单次 Agent 请求输入约为 `8,000–10,000` token，主要来自完整工具定义和历史上下文；
- 多个 NDJSON 通知可能位于同一个 sidecar stdout 批次，React 会在该批次处理结束后
  统一绘制，因此视觉上可能像整段出现。

## 修复

1. Runtime 客户端每次最多处理四条 stdout 协议消息，然后让出一个浏览器绘制周期。
2. 对话执行期间自动跟随最新输出。
3. 明确的寒暄、身份与能力问答不再携带 Agent 工具定义。
4. 编码任务和已有工具调用历史的线程继续保留完整工具能力。

## 验证边界

本地 TypeScript、React、Runtime 客户端测试和生产构建已覆盖增量分批处理。无工具
快速路径由 Runtime CI 的 Rust 请求体测试验证；真实 MiMo 首字延迟需要安装新构建后
使用用户凭据复测。

## CI 与安装包

- [Desktop CI #27397478351](https://github.com/MorganArthur/mimodex/actions/runs/27397478351)
  已验证桌面流式分批处理、React 界面和生产构建。
- [Runtime CI #27397710384](https://github.com/MorganArthur/mimodex/actions/runs/27397710384)
  已验证快速对话无工具请求、编码任务保留工具、MiMo app-server 生命周期和集成 crate。
- [Windows Preview #27397710374](https://github.com/MorganArthur/mimodex/actions/runs/27397710374)
  已完成真实 Runtime sidecar、Tauri 后端和 NSIS 安装包构建。
- 安装包 Artifact：
  [mimodex-windows-preview-a1761179d5360871cde1485480fba02fc31622f8](https://github.com/MorganArthur/mimodex/actions/runs/27397710374/artifacts/7585346441)
