# Mimodex Runtime 补丁工作区

Mimodex Runtime 基于固定版本的 OpenAI Codex Rust Runtime，并采用版本化补丁队列
维护 Mimodex 专属修改。

本目录不保存完整上游源码。GitHub Actions 会：

1. 从 `upstream.lock.json` 指定的 commit 检出 OpenAI Codex；
2. 按 `patches/series` 的顺序应用补丁；
3. 在 Windows Runner 上执行 Rust 格式、测试和编译验证；
4. 后续在桌面工程就绪后构建 Mimodex Windows 安装包。

## 为什么采用补丁队列

- 当前本地环境不安装 Rust、Cargo 或 MSVC；
- 完整 Codex Rust workspace 包含大量相互依赖的 crate，不能只复制当前稀疏检出的
  少量目录；
- 提交完整上游源码会让 Mimodex 仓库体积和上游同步成本快速增加；
- 补丁队列可以明确审计 Mimodex 相对固定上游 commit 的全部修改。

## 本地开发流程

1. 在 `spikes/codex-runtime/upstream` 的忽略工作区中修改上游源码。
2. 将一个可独立验证的修改导出为单个补丁。
3. 把补丁放入 `runtime/patches/`，并追加到 `runtime/patches/series`。
4. 本地执行补丁应用检查：

   ```powershell
   .\runtime\scripts\apply-patches.ps1 `
     -UpstreamPath .\spikes\codex-runtime\upstream `
     -CheckOnly
   ```

5. 提交补丁，由 `runtime-ci.yml` 在 GitHub Actions 中执行权威 Rust 验证。

本地上游工作区若已经包含未提交修改，不应直接运行补丁应用脚本；请在干净检出或新的
临时工作区验证补丁。

## 补丁规则

- 每个补丁只处理一个清晰目的；
- 文件名使用四位序号，例如 `0001-add-chat-completions-wire-api.patch`；
- 补丁必须能够按 `series` 顺序应用到锁定的上游 commit；
- 补丁必须包含对应测试，或在补丁说明中记录无法自动化验证的原因；
- 不得在补丁中包含凭据、生成产物或未脱敏 Fixture；
- 切换上游 commit 前，必须先让全部补丁在新基线上成功重放。

## 后续演进

补丁数量、冲突频率或 Mimodex 专属模块规模明显增大后，可以将 Runtime 迁移到独立的
Codex GitHub fork。迁移前补丁队列仍是 Mimodex 修改范围的权威清单。
