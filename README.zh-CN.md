# 费城犯罪数据面板 + 路线安全日记

中文 | [English](README.md)

[![CI](https://github.com/raederhans/engagement-project/actions/workflows/ci.yml/badge.svg)](https://github.com/raederhans/engagement-project/actions/workflows/ci.yml)
[![Node.js 22](https://img.shields.io/badge/Node.js-22-339933?logo=node.js&logoColor=white)](package.json)
[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

这是一个支持英文和简体中文的交互式 Web 应用，用于探索费城犯罪数据，并试用仅在浏览器中保存数据的“路线安全日记”。应用顶部提供语言切换按钮，语言偏好会保存在当前浏览器中。项目使用原生 JavaScript、MapLibre GL JS、Chart.js、Turf 和 Vite。

> [!IMPORTANT]
> 路线安全日记目前使用演示数据和浏览器本地状态，不提供生产账号、持久化社区提交或安全保证。犯罪地点为近似位置，不应作为个人安全决策的唯一依据。

## 功能

### 犯罪数据探索器

- 交互式警察分局和人口普查区地图。
- 400 米到 3.2 公里的可配置缓冲区分析。
- 月度比较、主要犯罪类型图表和 7 × 24 活动热力图。
- 使用 ACS 人口数据计算人均比率。
- 对大型结果集进行视口筛选与点位聚类。
- 英文和简体中文界面、帮助、状态及错误提示。

### 路线安全日记原型

- 带路段安全样式和可选替代路线的演示路线。
- 在本地保存路线评分、标签、备注和路段调整。
- 当前路线、我的路线、社区示例和洞察视图。
- 带会话级限流的社区反馈模拟。
- 可重复生成并验证的演示数据脚本。

## 快速开始

### 环境要求

- Node.js `^20.19.0` 或 `>=22.12.0`。
- npm 10 或更高版本。

安装锁定版本的依赖并启动开发服务器：

```bash
npm ci
npm run dev
```

打开 `http://localhost:5173/?mode=diary` 查看路线安全日记，或打开 `http://localhost:5173/` 查看犯罪数据面板。

### 可选 MapTiler 样式

如需使用 MapTiler 样式，请创建 `.env.local`：

```dotenv
VITE_MAPTILER_API_KEY=your_key_here
```

没有密钥时，应用使用 OpenStreetMap 备用底图。环境文件已被 Git 忽略，绝不能提交。

## 验证

运行与 CI 相同的仓库验证入口：

```bash
npm run validate
```

该命令依次执行：

- `npm run data:check`：验证仓库中的演示 GeoJSON。
- `npm test`：运行完整单元测试和契约测试，包括双语 UI 契约。
- `npm run build:manifest`：在 `dist/` 生成生产构建和 Vite manifest。
- `npm run verify:bundle`：检查入口文件和延迟加载 chunk 的体积预算。

局部开发时也可以单独运行：

```bash
npm run test:i18n
npm run test:diary:math
npm run test:diary:agg
npm run data:check
npm run build
```

## 演示数据

重新生成并验证路线安全日记的确定性数据：

```bash
npm run data:gen
npm run data:check
```

道路网络命令会读取外部 OpenStreetMap 或费城数据，因此与默认验证入口分开：

```bash
npm run data:fetch:streets
npm run data:segment:streets
```

## 项目结构

```text
src/
  api/              外部数据访问与标准化
  charts/           犯罪数据和日记图表
  i18n/             英文/简体中文词条与运行时
  map/              MapLibre 图层和交互
  routes_diary/     路线安全日记状态与界面
  state/            共享应用状态
scripts/
  tests/            轻量回归与契约测试
  *.mjs             数据生成和验证工具
server/api/diary/   原型 API 处理程序
data/               仓库内演示 GeoJSON
docs/               设计、数据和实现说明
```

## 数据来源与限制

| 来源 | 用途 |
| --- | --- |
| [Philadelphia CARTO](https://phl.carto.com/) | 犯罪事件查询 |
| [Philadelphia GIS](https://www.phila.gov/departments/office-of-innovation-and-technology/open-data/) | 警察分局和本地边界 |
| [US Census Bureau ACS](https://www.census.gov/programs-surveys/acs) | 人口基数 |
| [OpenStreetMap](https://www.openstreetmap.org/copyright) | 道路网络输入 |

犯罪点位会被取整到百号街区，因此仍是近似位置。外部服务的可用性、数据结构和限流规则可能独立变化。

## 部署

创建静态生产构建：

```bash
npm run build
```

可将生成的 `dist/` 目录部署到任意静态托管服务。仓库当前不发布 npm 或 GitHub Packages 包。Vite 配置会在 GitHub Actions 中自动使用仓库路径，`.github/workflows/deploy-pages.yml` 会从 `main` 构建并部署到 GitHub Pages。

## 文档

- [已知问题](docs/KNOWN_ISSUES.md)
- [控件规范](docs/CONTROL_SPEC.md)
- [路线安全日记规范](docs/DIARY_SPEC_M2.md)
- [后端 API 草案](docs/API_BACKEND_DIARY_M2.md)
- [数据与文件地图](docs/FILE_MAP_ENGAGEMENT.md)

## 参与贡献

请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。Bug 报告和改进建议可通过 [GitHub Issues](https://github.com/raederhans/engagement-project/issues) 提交。

## 许可证

项目原创软件采用 [MIT License](LICENSE)。第三方数据仍遵守各自来源的使用条款。
