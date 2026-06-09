# ADR-0003：实现原生 MiMo Chat Completions Provider

- 状态：已接受，必须完成技术验证
- 日期：2026-06-09

## 背景

MiMo 提供 OpenAI 兼容的 Chat Completions API 和 Anthropic 兼容 API。工具型
编程 Agent 需要流式推理、工具调用、工具结果、多轮重放、取消、错误分类和用量报告。

所选 Codex Runtime 文档中的自定义 Provider wire API 基于 Responses 语义，
因此仅将其指向 Chat Completions 端点并不足够。

MiMo 工具对话可能要求在后续请求中重放之前的助手 `reasoning_content`。在官方
文档描述的受影响场景中，缺失该字段会导致 400 响应，因此只保存普通聊天文本并不安全。

## 决策

在 Codex Runtime 分支的模型传输边界新增 `ChatCompletions` wire API，并实现原生
MiMo Provider Adapter。Adapter 将 MiMo Chat Completions 请求和 SSE 响应映射为
Runtime 现有的 `Prompt`、`ResponseEvent` 与 `ResponseItem`。

不把 MiMo 伪装成 Responses API，也不在 Agent 循环、工具层或 app-server 中散布
MiMo 专属分支。

Adapter 必须：

- 将 Provider 中立的 system、user、assistant 和 tool 项目映射为 MiMo 消息；
- 将 `reasoning_content` 作为一等可重放字段保存；
- 解析流式文本、推理、工具调用 ID、名称和参数增量；
- 只有在 Spike 验证后才启用多工具调用；
- 将工具结果映射回正确的工具调用 ID；
- 归一化结束原因、用量、请求 ID 和错误；
- 支持取消与有界重试；
- 只通过脱敏诊断信息暴露 Provider 原始细节。

认证首版通过 Provider `env_http_headers` 从 `MIMO_API_KEY` 注入 `api-key` Header，
不使用现有 `env_key` 的 Bearer 认证路径。

Codex 的 Agent 循环、工具执行、审批、沙箱、取消、线程、rollout 和 app-server
协议继续复用。Responses 专属工具和传输能力由 Provider capability 默认禁用。

如果 Spike 发现 Chat Completions 存在阻断问题，则将 Anthropic 兼容 API
作为备选方案。

## 决策理由

- 将 Provider 专属语义集中封装在 Adapter 中。
- Runtime 和 UI 可以基于稳定的标准事件工作。
- 显式处理重放要求，避免依赖偶然兼容性。
- Mimodex 能自行控制重试、错误信息和诊断体验。

## 影响

### 正面影响

- 可以测试并维护正确的多轮工具行为。
- 未来可增加 MiMo 专属功能，而无需将 wire 细节泄露至 UI。
- Provider 错误可以转换为用户可理解的产品状态。

### 负面影响

- Adapter 成为关键兼容层，必须持续跟进 MiMo API 变化。
- 上下文压缩必须保留 Provider 要求的推理状态。
- 流式工具参数组装复杂，需要容忍碎片化增量。
- 通用上游 Provider 测试不足以覆盖该 Adapter。
- 上游已主动移除 Chat wire API，后续合并需要持续控制改动范围。

## Provider 中立契约要求

Runtime Provider 接口必须表达：

- 有序输入项目；
- 相互独立的助手文本与推理字段；
- 工具定义与工具选择；
- 流式输出事件；
- 稳定工具调用身份；
- 用量与结束元数据；
- 是否可重试与归一化错误；
- 取消。

接口不得要求所有 Provider 模拟原始 Responses Payload。

## 重试策略

仅在 Runtime 能证明以下条件时允许自动重试：

- 失败响应尚未触发工具副作用；
- 请求可以安全重复；
- 重试次数和退避有明确上限；
- 最终失败仍对用户可见。

## 验证门槛

只有 [MiMo Provider 技术验证清单](../../validation/MIMO_PROVIDER_SPIKE.md)
中的强制条件全部通过后，该决策才可进入正式实现。

源码盘点结果见：[Codex Runtime 接入盘点](../CODEX_RUNTIME_INVENTORY.md)。

## 未采用方案

### 只覆盖 Base URL

不采用。请求、流式响应和重放语义不同。

### 通过远程代理服务转换 MiMo

首版不采用。该方案削弱本地优先定位，并引入另一个处理用户代码和凭据的服务。

### 优先使用 Anthropic 兼容接口

并未永久排除，但初始优先选择 Chat Completions，因为它符合预期 Adapter 形态，
且更贴近既有 OpenAI 兼容生态。

## 参考

- https://platform.xiaomimimo.com/docs/en-US/api/chat/openai-api
- https://platform.xiaomimimo.com/docs/en-US/quick-start/first-api-call
- https://platform.xiaomimimo.com/docs/en-US/usage-guide/passing-back-reasoning_content
