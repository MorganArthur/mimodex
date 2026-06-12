# MiMo 交互延迟与身份错误验证记录

- 日期：2026-06-12
- 范围：已安装 Mimodex 的真实 Runtime 原始事件账本
- 结论：截图中的回答来自 MiMo API 流式输出，不是桌面端演示数据；首字延迟和错误
  身份回答由请求策略造成。

## 观测

两次简单对话从 `turn/start` 到首个 `item/agentMessage/delta` 分别约为 `9.8s` 和
`9.7s`。在回答出现前，MiMo 先输出了约 `9.3s` 的 `reasoning_content`。第二次
对话中，“我是 Claude”及后续文字逐段出现在 Runtime 的
`item/agentMessage/delta` 通知中，因此可以确认是接口真实返回。

当时 Runtime 为每次请求使用约 `21 KB` 的上游 Codex 默认系统提示，并未设置
MiMo `thinking` 参数。该提示包含 Codex CLI 与 OpenAI 身份语境，导致 MiMo 产生
错误身份回答。

## 修复策略

1. 用小于 `2 KB` 的 Mimodex 专属 MiMo 系统提示替换上游 Codex 默认提示。
2. 新建和恢复桌面线程时都覆盖身份提示，确保已有线程升级后也使用新提示。
3. 按照小米 MiMo 官方工具调用建议设置 `thinking.type = disabled`，避免简单交互先
   执行无必要的深度思考。
4. 轮次结束时将流式消息状态从 `inProgress` 收口为最终状态。

## 验证结果

- [Runtime CI #27393023486](https://github.com/MorganArthur/mimodex/actions/runs/27393023486)
  已验证 Provider 身份提示、Chat Completions 请求体、工具闭环和 app-server 生命周期。
- [Windows Preview #27393023482](https://github.com/MorganArthur/mimodex/actions/runs/27393023482)
  已验证桌面测试、Tauri 后端、Runtime 握手和 NSIS 打包。
- 安装包大小：`56.89 MiB`
- 安装包 SHA256：`F51CA54F0B04BA8870F3DD2228E82E244923AFFF7BD758E4DB1DB4F18BF010F8`

参考：

- [小米 MiMo OpenAI API 兼容文档](https://platform.xiaomimimo.com/docs/zh-CN/api/chat/openai-api)
- [小米 MiMo FAQ：工具调用时建议关闭 thinking](https://platform.xiaomimimo.com/docs/en-US/faq)
