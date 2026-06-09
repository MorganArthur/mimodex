# MiMo Runtime Adapter 实现计划

- 状态：MIMO-RUNTIME-001 已进入 CI 验证
- 最后更新：2026-06-09
- 上游基线：`14660c22d14312c28a50c52954dd77dd88f03c26`
- 构建策略：本地不安装 Rust，GitHub Actions 为权威原生验证环境

## 1. 当前下一步

先完成 Runtime 补丁队列和 Windows CI 的首次远程验证，再实现
`ChatCompletions` Adapter。这样首个 Rust 修改产生编译错误时，可以确认问题来自
补丁本身，而不是 CI 基础设施。

执行顺序：

1. 将当前 Mimodex 仓库关联到 GitHub 仓库。
2. 提交当前文档、Provider Spike、补丁队列骨架和两个 CI Workflow。
3. 推送并确认 `Provider Spike CI` 与 `Runtime CI` 均通过。
4. 补丁 `0001-add-chat-completions-wire-api.patch` 已建立，等待 Runtime CI 验证。

## 2. 垂直切片

### MIMO-RUNTIME-001：新增 wire API 类型

范围：

- `model-provider-info` 增加显式 `chat_completions` wire API；
- 保持旧配置 `wire_api = "chat"` 的明确报错；
- `core/client.rs` 增加可编译的分派入口；
- 增加配置序列化、反序列化和分派测试。

验收：

- Responses Provider 行为不变；
- 未实现的 Chat Completions 请求返回明确错误；
- Runtime CI 全部通过。

### MIMO-RUNTIME-002：确定性 Chat 历史编码

范围：

- 将 `Prompt` 转成 MiMo Chat messages；
- 正确组合 system、user、assistant、reasoning 和 tool 消息；
- 完整保留 `reasoning_content` 与 `tool_call_id`；
- 仅允许首版支持的函数工具。

验收：

- 黄金 Fixture 覆盖基础消息、连续工具和同响应多工具；
- 编码结果中没有 Responses 专属字段；
- 不支持的工具类型返回明确能力错误。

### MIMO-RUNTIME-003：MiMo SSE 解析

范围：

- 新增 `/chat/completions` 流式端点；
- 累积文本、推理和碎片化工具参数；
- 映射用量、响应 ID 和结束原因；
- 输出现有 `ResponseEvent`。

验收：

- 使用脱敏 Fixture 覆盖任意网络分块；
- 工具参数完整前不会产生完成工具调用；
- 文本、推理和工具事件顺序稳定。

### MIMO-RUNTIME-004：Core 基础模型流

范围：

- `ModelClientSession::stream` 分派到 Chat Completions Adapter；
- 注册 MiMo Provider 与静态模型目录；
- `mimo-v2.5` 默认，`mimo-v2.5-pro` 高级可选；
- 关闭未验证的 Responses 专属能力。

验收：

- app-server 可以创建 MiMo 线程并完成无工具轮次；
- 文本、推理、完成和用量事件可被客户端消费；
- 取消模型流后线程可继续使用。

### MIMO-RUNTIME-005：工具循环与恢复

范围：

- 接通标准函数工具；
- 验证并行、连续、拒绝、失败和取消；
- rollout 持久化与恢复；
- 验证上下文规范化不会破坏 MiMo 历史。

验收：

- app-server 完成 Fixture 工具闭环；
- 进程重启后恢复并继续轮次；
- 工具调用与结果 ID 全部匹配；
- `reasoning_content` 在持久化与重放中不丢失。

## 3. 提交策略

- 每个垂直切片拆成一个或少量可独立验证的补丁；
- 一次提交不混入桌面 UI；
- CI 失败时优先修复当前补丁，不叠加下一阶段修改；
- 每个补丁通过后更新 Runtime 盘点和验证状态文档；
- Runtime 端到端闭环通过后，才开始 Tauri 桌面主流程。
