# Tasks

- [x] Task 1: 创建 GitHub Actions 部署工作流
  - [x] SubTask 1.1: 在 `.github/workflows/pages.yml` 中定义 workflow，包含 checkout、setup-node、install、build、deploy 步骤
  - [x] SubTask 1.2: 配置 workflow 触发条件：`push` 到 `main` 分支 + `workflow_dispatch`
  - [x] SubTask 1.3: 使用 `actions/deploy-pages` 进行部署
  - [x] SubTask 1.4: 配置正确的 `permissions`（contents: read, pages: write, id-token: write）

- [x] Task 2: 验证并修复 Vite 配置
  - [x] SubTask 2.1: 确认 `website/vite.config.ts` 中 `base` 设置为 `'./'`
  - [x] SubTask 2.2: 确认 `outDir` 为 `'dist'`
  - [x] SubTask 2.3: `index.html` 中 favicon 路径已改为相对路径 `./favicon.svg`

- [x] Task 3: 本地构建验证
  - [x] SubTask 3.1: 在 `website/` 目录运行 `npm run build`
  - [x] SubTask 3.2: 确认 `dist/` 目录生成且包含 `index.html` 和 `images/` 子目录（16 张图片）
  - [x] SubTask 3.3: 运行 `npm run check` 确认 TypeScript 无错误
  - [x] SubTask 3.4: 运行 `npm run lint` 确认无 lint 错误

- [x] Task 4: 配置 GitHub 仓库 Pages 设置
  - [x] SubTask 4.1: 在仓库 Settings > Pages 中设置 Source 为 "GitHub Actions"
  - [x] SubTask 4.2: 确认部署分支/环境配置正确

# Task Dependencies
- Task 2 必须在 Task 1 之前完成（配置正确才能部署成功）
- Task 3 必须在 Task 1 之前完成（本地验证通过才能推送到 CI）
- Task 4 在 Task 1 完成后执行（仓库设置在工作流创建后配置）
