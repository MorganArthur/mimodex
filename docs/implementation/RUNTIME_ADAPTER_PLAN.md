# MiMo Runtime Adapter 实现计划

- 状态：MIMO-RUNTIME-004 已完成，准备开始 MIMO-RUNTIME-005
- 最后更新：2026-06-10
- 上游基线：`14660c22d14312c28a50c52954dd77dd88f03c26`
- 构建策略：本地不安装 Rust，GitHub Actions 为权威原生验证环境

## 1. 当前下一步

Runtime 补丁队列、Wire API 边界、确定性 Chat 历史编码与 MiMo SSE 解析均已通过
远程验证。`MIMO-RUNTIME-004` 的 Core 基础模型流、内置 MiMo Provider 与静态模型
目录也已通过 Windows Runtime CI 权威验证。

已完成：

1. Mimodex 仓库已关联并推送至 GitHub。
2. `Provider Spike CI` 与空补丁 `Runtime CI` 基线通过。
3. `0001-add-chat-completions-wire-api.patch` 已通过格式、配置往返、核心分派测试和
   Windows Runtime/app-server 集成编译。
4. `0002-add-chat-completions-history-encoder.patch` 已通过黄金测试、边界 crate
   测试和 Windows Runtime/app-server 集成编译。
5. `0003-add-mimo-chat-completions-sse-parser.patch` 已通过任意网络分块、流式事件、
   工具参数失败边界测试和 Windows Runtime/app-server 集成编译。
6. `0004-add-mimo-core-basic-model-flow.patch` 已通过基础流、Provider 注册、
   默认/高级模型目录和 Windows Runtime/app-server 集成编译。
7. `0005-add-mimo-tool-loop-and-recovery.patch` 已完成实现，当前等待 Windows
   Runtime CI 验证。

当前执行顺序：

1. 通过 Windows Runtime CI 验证 `MIMO-RUNTIME-005`。
2. 根据 CI 结果修复格式、编译或跨平台生命周期问题。
3. 验证通过后冻结工具循环与恢复边界，进入桌面端 Runtime 接入。

## 2. 垂直切片

### MIMO-RUNTIME-001：新增 wire API 类型

状态：已完成。验证记录：
[Runtime CI #27196469523](https://github.com/MorganArthur/mimodex/actions/runs/27196469523)。

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

状态：已完成。验证记录：
[Runtime CI #27199629111](https://github.com/MorganArthur/mimodex/actions/runs/27199629111)。

范围：

- 将 `Prompt` 转成 MiMo Chat messages；
- 正确组合 system、user、assistant、reasoning 和 tool 消息；
- 将 Codex `developer` 上下文确定性降级为 system 消息；
- 完整保留 `reasoning_content` 与 `tool_call_id`；
- 仅允许首版支持的函数工具。

验收：

- 黄金 Fixture 覆盖基础消息、连续工具和同响应多工具；
- 编码结果中没有 Responses 专属字段；
- 不支持的工具类型返回明确能力错误。

### MIMO-RUNTIME-003：MiMo SSE 解析

状态：已完成。验证记录：
[Runtime CI #27202335810](https://github.com/MorganArthur/mimodex/actions/runs/27202335810)。

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

状态：已完成。验证记录：
[Runtime CI #27245545541](https://github.com/MorganArthur/mimodex/actions/runs/27245545541)。

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

状态：实现完成，等待 Windows Runtime CI 验证。

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
