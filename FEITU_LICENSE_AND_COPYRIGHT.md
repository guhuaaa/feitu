# 《废土末班车》第三方许可证与版权边界说明

版本：DSH 0.1 · 文档日期：2026-08-18

---

## 一、上游软件许可

### Narrative Engine 1.0.4（MIT）

- 上游仓库：`upstream_sources/NarrativeEngine-P/`
- 固定提交：`3c3ed4f503da55db0e2498f3b830619ef0b2e842`
- 许可：MIT License（详见 `upstream_sources/NarrativeEngine-P/LICENSE`）
- 说明：本项目在 Narrative Engine 之上以模组（mod）方式扩展，模组代码与上游代码分离存放于 `upstream_sources/NarrativeEngine-P/mods/feitu-last-train.*`，不修改上游核心源码。

### 前端与运行时依赖

所有 npm 依赖（React、Vite、Express、vitest 等）均为上游 Narrative Engine 的既有依赖，
许可与来源见 `upstream_sources/NarrativeEngine-P/node_modules` 下各包自带的 LICENSE。

### DSH 生态工具

- `@deepseek-ai/dsh@0.1.0-rc.6` 及其 Cordis 依赖由 DeepSeek Harness 上游发布；本项目只通过公开插件接口接入。
- `dsh-eval-harness@0.3.0` 为 MIT 许可，来源为
  `https://github.com/BiBoyang/dsh-eval-harness`；它只用于隔离验收 runner，不进入 `dsh-feitu-world` 发布包。
- `dsh-playwright-browser` 仅作为验收设计参考，不被运行时依赖或资源包捆绑。

---

## 二、本项目的可公开部分

以下内容为本项目原创，可随项目公开分发：

| 内容 | 位置 |
| --- | --- |
| 模组清单与计算逻辑 | `upstream_sources/NarrativeEngine-P/mods/feitu-last-train.mod.json`、`feitu-last-train.compute.js`、`feitu-last-train.endings.js` |
| 控制台屏幕 | `upstream_sources/NarrativeEngine-P/mods/feitu-last-train.screen.js` |
| 初始战役包（原创改编数据） | `feitu_campaign/`（战役元数据、开场状态、Lore/Rules 精简条目、NPC 台账） |
| 战役包导入器 | `feitu_campaign/import-feitu-campaign.mjs`、`import-project-assets.py` |
| 一键启动器 | `upstream_sources/NarrativeEngine-P/start-feitu.mjs`、`Start_Feitu_Last_Train.bat` |
| 模组与结局自动测试 | `upstream_sources/NarrativeEngine-P/src/services/mods/__tests__/feituLastTrain*.test.js` |
| DSH 插件运行时与玩家预览 | `packages/dsh-feitu-world/` |
| DSH 玩家验收用例与报告摘要 | `simulation/game_design/implementation/dsh-eval-cases/`、`DSH_EVAL_HARNESS_ACCEPTANCE.json` |
| 原创 SVG UI/地图/线索资源 | `packages/dsh-feitu-world/ui/*.svg` |
| 压力时钟与 NPC 可见性契约 | `packages/dsh-feitu-world/content/*contract.json` |

---

## 三、版权边界（重要）

### 3.1 未授权内容不得进入公开发布包

本项目改编自小说《我在废土世界扫垃圾》。**未取得授权前**，公开发布包不得包含：

- 小说全文；
- 长段原文对白或大段原文段落；
- 原作插图、封面或其它受版权保护的素材。

### 3.2 本项目当前的处理

- 初始战役包中的 Lore/Rules 条目为**精简事实与规则**（短条目），并非原文段落；
- 每条条目标注来源等级：`CANON`（源于原作文本的事实提炼）/ `INFERENCE`（基于事实的合理推断）/ `UNKNOWN`（无法在本副本内验证）；
- 未引入小说原文文件到战役包；
- 原始素材 `《我在废土世界扫垃圾》完结+全番外.txt` 与 `data/processed/` 仅存在于本地分析目录，**不在发布清单内**。
- `npm pack --dry-run` 已核对 DSH 0.2.2 包包含 27 个运行时/内容/UI 文件（含两张原创 PNG、世界枢纽 SVG、规范化作者图、世界注册表和运行时世界适配器），不包含小说全文、分析目录、验收 trace 或本地存档；压力时钟、NPC 可见性、作者层和世界枢纽契约随内容包发布，便于离线复核。

### 3.3 后续替换与授权审计

- 事实库 / 规则库等分析资产位于 `analysis/`、`simulation/`，均为内部研究产物；
- 若取得授权或希望去除原著关联，可替换 `feitu_campaign/` 中的条目为纯原创数据，游戏结构无需改动；
- `factLevel` 字段保留来源等级，便于审计与替换。

### 3.4 数据协议约束

- 旧 Narrative Engine 模组链路不使用哈希、校验和或摘要机制；版本兼容通过
  `schemaVersion`、`moduleVersion`、`eventId`、`createdAt`/`updatedAt` 与字段级结构校验表达。
- DSH 新运行时的 `deterministic_state_hash` 仅用于 checkpoint/replay 的运行时一致性，
  不用于版权证明、来源证明、发布鉴权或内容完整性判断；它属于
  `CHECKPOINT_CONTRACT.md` 的玩家存档字段，不能替代来源/OOC 审计。
- 导入导出走「预览 → 确认 → 原子写入 + 备份」，不依赖内容摘要判断。

---

## 四、商标与署名

- 「废土末班车」为本项目自创战役名称，与上游引擎无品牌关联；
- Narrative Engine 及其商标、图标归其原作者所有；
- 本项目不主张对上游引擎或其商标的任何权利。
