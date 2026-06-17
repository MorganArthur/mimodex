# 部署 Mimodex 介绍页到 GitHub Pages Spec

## Why
Mimodex 项目介绍页（website/）已开发完成，需要部署到 GitHub Pages 以便公开展示。用户没有独立服务器，GitHub Pages 是零成本托管静态站点的最佳方案。

## What Changes
- 新增 `.github/workflows/pages.yml`：GitHub Actions 工作流，自动构建 website 并部署到 GitHub Pages
- 修改 `website/vite.config.ts`：确认 base 配置为 `./` 以支持 GitHub Pages 子路径部署
- 修改 `website/index.html`：确认资源引用路径兼容相对路径部署
- 新增/修改 `website/package.json`：如有需要添加 `homepage` 字段
- 验证构建产物 `website/dist/` 能正确生成并包含所有图片资源

## Impact
- Affected specs: 无（新增部署能力）
- Affected code: `.github/workflows/pages.yml`, `website/vite.config.ts`, `website/index.html`

## ADDED Requirements

### Requirement: GitHub Pages 自动部署
The system SHALL provide an automated GitHub Actions workflow that builds and deploys the Mimodex website to GitHub Pages on every push to the main branch.

#### Scenario: Push to main triggers deployment
- **WHEN** code is pushed to the `main` branch
- **THEN** the GitHub Actions workflow SHALL trigger, build the website, and deploy to GitHub Pages

#### Scenario: Manual deployment
- **WHEN** a maintainer triggers the workflow manually via `workflow_dispatch`
- **THEN** the website SHALL be rebuilt and redeployed

#### Scenario: Correct base path for GitHub Pages
- **WHEN** the site is served from a GitHub Pages subpath (e.g. `/mimodex/`)
- **THEN** all assets (JS, CSS, images) SHALL load correctly using relative paths

#### Scenario: Images included in build
- **WHEN** the build completes
- **THEN** all images from `website/public/images/` SHALL be present in the `dist/` output

#### Scenario: Build verification passes
- **WHEN** the workflow runs
- **THEN** TypeScript compilation (`tsc -b`) and build (`vite build`) SHALL both succeed
