# Tauri Sidecar Windows 技术预览说明

- 状态：Runtime IPC 修复版 Windows 技术预览已通过权威构建
- 最后更新：2026-06-11
- 对应目录：`apps/desktop/src-tauri`、`apps/desktop/src/runtime`
- 对应工作流：`.github/workflows/windows-preview.yml`
- 首次成功构建：[Windows Preview #27319183630](https://github.com/MorganArthur/mimodex/actions/runs/27319183630)
- 当前可用构建：[Windows Preview #27322304835](https://github.com/MorganArthur/mimodex/actions/runs/27322304835)

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

首次成功构建的安装包大小为 `55.98 MiB`。其中 Runtime 原始可执行文件约
`214.27 MiB`，由 NSIS 压缩后仍满足 `120 MiB` 安装包硬上限。对应 Artifact：
[mimodex-windows-preview-6220ea0b89931b3a80967b2dc4e56ea8dac504cc](https://github.com/MorganArthur/mimodex/actions/runs/27319183630/artifacts/7553844185)。

> 该首个 Artifact 在真实安装验证中发现 Tauri raw IPC 字节数组兼容问题，安装后
> Runtime 初始化响应无法被前端解码，已经停止作为可用预览分发。

修复版 Artifact：
[mimodex-windows-preview-60d643eeb3c84dd4277e30782b82bb1e44fdd0b2](https://github.com/MorganArthur/mimodex/actions/runs/27322304835/artifacts/7554941223)。
该构建已通过 Runtime `initialize` 握手、NSIS 打包与独立 SHA256 校验；安装包大小
为 `55.98 MiB`，SHA256 为
`3B3EC46CC40F146DC057E82ECB03A1F55A4C48FF176EAEE6BF03CAE1CEC3C0B8`。

## 4. 当前使用限制

- 首个安装包用于验证真实 Runtime 连接、线程、轮次、审批、中断和文件修改闭环；
- Runtime IPC 修复版仍需通过应用内凭据设置与 Windows 凭据管理器的真实安装验收；
- 尚未提供连接诊断、自定义 API Base URL 和正式代码签名；
- CI 会执行 Runtime `initialize` 握手，但正式发布前仍需执行真实 Windows 11 安装、
  启动、Agent 闭环和卸载验收。

## 5. 下一阶段

1. 在真实 Windows 11 环境完成安装与 Runtime 握手；
2. 验证默认模型、高级模型、审批、停止和工作区 Diff；
3. 验证应用内 MiMo 凭据设置、重启加载和删除；
4. 增加连接诊断与自定义 API Base URL；
5. 为签名发布工作流补齐安装、启动和卸载冒烟测试。
