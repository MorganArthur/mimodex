# MiMo 凭据设置与安全存储

- 状态：已实现并通过 Windows CI，等待真实安装验收
- 最后更新：2026-06-11
- 对应目录：`apps/desktop/src-tauri/src/main.rs`、`apps/desktop/src/credentials.ts`、
  `apps/desktop/src/DesktopRoot.tsx`

## 1. 本阶段目标

让全新安装的 Mimodex 用户无需手工配置 `MIMO_API_KEY` 环境变量，即可在应用内
保存 MiMo API Key，并在应用重启后自动供 Runtime 使用。

## 2. 安全边界

- API Key 由 Tauri 命令接收并写入 Windows 凭据管理器；
- 保存后的明文 Key 不返回 React，也不写入项目、普通配置或日志；
- 前端只能读取“是否已配置”、凭据来源和安全存储名称；
- 应用启动时，Tauri 后端在创建工作线程和 Runtime sidecar 前读取凭据；
- Runtime sidecar 继续通过 `MIMO_API_KEY` 环境变量使用凭据；
- Tauri 注入的环境变量带有内部来源标记；删除凭据后的重启会清除继承的旧 Key；
- 新增、更换或删除凭据后重启应用，避免在多线程进程中修改环境变量。

Windows 凭据条目使用：

- Service：`com.morganarthur.mimodex`
- User：`mimo-api-key`
- 存储：当前 Windows 用户的 Windows 凭据管理器

## 3. 用户流程

### 首次启动

1. Tauri 后端检查 Windows 凭据管理器；
2. 未找到凭据时，不创建 Runtime；
3. 用户在首次设置界面输入 API Key；
4. Tauri 后端安全保存凭据；
5. Mimodex 重启并在 Runtime 启动前注入凭据。

### 已配置用户

1. 应用启动时自动加载凭据；
2. 主界面左下角设置入口显示安全存储状态；
3. 用户可以输入新 Key 替换旧凭据，或删除已保存凭据；
4. 修改后应用重启，以确保 Runtime 使用最新状态。

### 环境变量兼容

如果 Windows 凭据管理器中没有 Key，但启动进程已经提供 `MIMO_API_KEY`，Mimodex
仍允许进入主界面，并把来源标记为“当前使用环境变量”。用户可在设置中保存新 Key，
将凭据迁移到 Windows 凭据管理器。

## 4. 当前限制

- 首版固定使用官方端点 `https://api.xiaomimimo.com/v1`；
- 保存动作只验证 Key 非空和长度，真实 Provider 认证由首次任务验证；
- 自定义 Base URL、独立连接诊断和认证错误引导将在后续阶段实现；
- Windows CI-only 构建意味着 Rust 后端需要由 Windows Preview 工作流完成权威验证。

## 5. 验收

- [x] 未配置凭据时不创建 Runtime；
- [x] 前端无法读取保存后的明文 Key；
- [x] 首次设置、替换与删除流程具备交互测试；
- [x] 浏览器演示环境中的设置弹窗通过人工检查；
- [x] Windows CI 编译通过；
- [ ] 真实 Windows 凭据管理器保存、重启加载和删除通过；
- [ ] 使用安全存储凭据完成一次真实 MiMo 任务。

Windows CI 构建：
[Windows Preview #27327273086](https://github.com/MorganArthur/mimodex/actions/runs/27327273086)。
对应 Artifact：
[mimodex-windows-preview-1548820e6fefbbbd03687ce24513e584c8533b58](https://github.com/MorganArthur/mimodex/actions/runs/27327273086/artifacts/7557107931)。

安装包大小为 `56.01 MiB`，SHA256 为
`89C82F3310B2527C06912C664E9C9F37C7935EDCC51E392FE5889436841B7FD2`。
