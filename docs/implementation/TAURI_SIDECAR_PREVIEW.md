# Tauri Sidecar Windows 技术预览说明

- 状态：代码与 CI 工作流已建立，等待首个权威构建通过
- 最后更新：2026-06-11
- 对应目录：`apps/desktop/src-tauri`、`apps/desktop/src/runtime`
- 对应工作流：`.github/workflows/windows-preview.yml`

## 1. 本阶段目标

本阶段把已验证的 Mimodex Runtime 接入 Tauri 2 桌面外壳，并由 GitHub Actions 产出
首个可安装的 Windows 11 x64 技术预览。该预览用于原生闭环验收，不是正式签名版本。

## 2. 运行结构

安装包只包含运行所需文件：

- Mimodex Tauri 主程序与 React 前端；
- 重命名为 Tauri sidecar 的 `codex-app-server.exe`；
- `codex-command-runner.exe`；
- `codex-windows-sandbox-setup.exe`。

Rust 工具链、Cargo 缓存、Codex 源码、测试产物和调试符号不会进入安装包。

浏览器开发环境继续使用 `DemoRuntimeClient`。Tauri 环境通过
`TauriRuntimeProcessPort` 启动打包的 sidecar，并把标准输入输出、错误和退出事件适配
到现有 Runtime 客户端。

## 3. 获取安装包

`Windows Preview` 工作流会上传名为
`mimodex-windows-preview-<commit SHA>` 的 Actions Artifact，内容包括：

- `Mimodex_0.1.0_x64-setup.exe`；
- `Mimodex_0.1.0_x64-setup.exe.sha256`。

技术预览安装包未签名，Windows SmartScreen 可能显示警告。Artifact 默认保留 14 天。

## 4. 当前使用限制

- 启动 Mimodex 前，当前用户环境需要提供 `MIMO_API_KEY`；
- 首个安装包用于验证真实 Runtime 连接、线程、轮次、审批、中断和文件修改闭环；
- 尚未提供图形化凭据录入、Windows 凭据管理器存储和正式代码签名；
- 正式发布前仍需执行真实 Windows 11 安装、启动、Agent 闭环和卸载验收。

## 5. 下一阶段

1. 取得首个通过的 `Windows Preview` 安装包并记录体积；
2. 在真实 Windows 11 环境完成安装与 Runtime 握手；
3. 验证默认模型、高级模型、审批、停止和工作区 Diff；
4. 增加应用内 MiMo 凭据设置与安全存储；
5. 为签名发布工作流补齐安装、启动和卸载冒烟测试。
