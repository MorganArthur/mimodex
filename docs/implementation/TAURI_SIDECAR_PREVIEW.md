# Tauri Sidecar Windows 技术预览说明

- 状态：SQLite 线程账本版 Windows 技术预览已通过权威构建
- 最后更新：2026-06-11
- 对应目录：`apps/desktop/src-tauri`、`apps/desktop/src/runtime`
- 对应工作流：`.github/workflows/windows-preview.yml`
- 首次成功构建：[Windows Preview #27319183630](https://github.com/MorganArthur/mimodex/actions/runs/27319183630)
- Runtime IPC 修复构建：[Windows Preview #27322304835](https://github.com/MorganArthur/mimodex/actions/runs/27322304835)
- 凭据设置构建：[Windows Preview #27330345759](https://github.com/MorganArthur/mimodex/actions/runs/27330345759)
- 项目管理构建：[Windows Preview #27334790840](https://github.com/MorganArthur/mimodex/actions/runs/27334790840)
- 当前可用构建：[Windows Preview #27353878773](https://github.com/MorganArthur/mimodex/actions/runs/27353878773)

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

当前凭据设置版 Artifact：
[mimodex-windows-preview-94c0d08fed6f4952ed58f3c51cc04dab94d5c447](https://github.com/MorganArthur/mimodex/actions/runs/27330345759/artifacts/7558340455)。
该构建增加首次设置、Windows 凭据管理器安全存储、替换与删除凭据功能，并通过
Tauri Rust 后端编译、Runtime 握手、NSIS 打包与独立 SHA256 校验。安装包大小为
`56.02 MiB`，SHA256 为
`97C255C1A83FF101C8D3768D922D4E2F66D81F3F89E44CF405297AA03BF517B9`。

当前项目管理版 Artifact：
[mimodex-windows-preview-275b5fc357e31c178f9f954489ca962eab61c740](https://github.com/MorganArthur/mimodex/actions/runs/27334790840/artifacts/7560857730)。
该构建增加原生文件夹选择、项目记录持久化、Git 摘要、项目切换和失效路径保护，
并通过 Tauri Rust 后端编译、Runtime 握手、NSIS 打包与独立 SHA256 校验。安装包
大小为 `56.13 MiB`，SHA256 为
`989B4D62A6F5888BB88293475C94D1C6E8CEC55EE63BFC5E019D5EFD48518E80`。

当前线程恢复版 Artifact：
[mimodex-windows-preview-d3b7671c7833fbf1074b35a537f31d1bd2c08a2d](https://github.com/MorganArthur/mimodex/actions/runs/27342769848/artifacts/7564072128)。
该构建将演示最近线程替换为真实本地线程索引，支持按项目筛选、Runtime
`thread/resume`、历史 UI 投影恢复、新建线程和继续对话，并通过 Tauri Rust 后端
编译、Runtime 握手、NSIS 打包与独立 SHA256 校验。安装包大小为 `56.14 MiB`，
SHA256 为
`678A486A8C7CCAF9E25CE76E0B1870F1D730934B7C634C677B6EFACA8C39D331`。

当前 SQLite 线程账本版 Artifact：
[mimodex-windows-preview-7c4f68d13950d95a9b85b2e244eadcd2b32e941d](https://github.com/MorganArthur/mimodex/actions/runs/27353878773/artifacts/7569045083)。
该构建将线程索引迁移为 bundled SQLite 事件账本与查询投影，支持旧 JSON 一次性导入、
崩溃恢复、Runtime 归档与恢复归档、本地索引移除，并通过新增的 Tauri Rust SQLite
单测、Runtime 握手、NSIS 打包与独立 SHA256 校验。安装包大小为 `56.88 MiB`，
SHA256 为
`3CE761AAA61AFB30487310223C87127698A70E15B904CDC8A5586F8EAE3A549C`。

## 4. 当前使用限制

- 首个安装包用于验证真实 Runtime 连接、线程、轮次、审批、中断和文件修改闭环；
- Runtime IPC 修复版仍需通过应用内凭据设置与 Windows 凭据管理器的真实安装验收；
- 真实项目管理版新增文件夹选择、项目持久化、Git 摘要和项目切换，仍需完成安装验收；
- SQLite 线程账本版仍需在真实安装环境验证旧 JSON 导入、归档、恢复归档和本地索引移除；
- 尚未提供连接诊断、自定义 API Base URL 和正式代码签名；
- CI 会执行 Runtime `initialize` 握手，但正式发布前仍需执行真实 Windows 11 安装、
  启动、Agent 闭环和卸载验收。

## 5. 下一阶段

1. 在真实 Windows 11 环境验证旧 JSON 迁移、归档、恢复归档和本地索引移除；
2. 将全部有序 Runtime 原始事件直接写入账本，并从事件重建桌面投影；
3. 增加连接诊断与自定义 API Base URL；
4. 为签名发布工作流补齐安装、启动和卸载冒烟测试。
