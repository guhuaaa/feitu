# 《废土末班车》上线方案（GitHub + Steam）

更新日期：2026-10-09

## 1. 推荐产品形态

建议把项目定义为“有确定性规则与存档的 AI 叙事冒险”，而不是 SillyTavern 插件或 DeepSeek Harness 插件。玩家下载后应直接启动游戏；DSH/Cordis 继续作为开发与高级集成接口，但不应成为 Steam 玩家必须理解的前置依赖。

推荐发布架构：

1. 保留 `packages/dsh-feitu-world` 作为唯一规则、内容和存档真值层。
2. 用 Electron 包装现有 HTML/CSS/JavaScript 玩家界面，并在主进程内启动/导入本地服务。
3. 把存档从包目录迁移到 Electron `userData` 下的稳定目录，供 Steam Auto-Cloud 同步。
4. 离线确定性解释器必须能完成基础游戏；联网模型负责增强叙事，而不是决定产品是否能启动。
5. 首发只承诺 Windows 10/11 64 位。macOS/Linux 在有真实设备验证和签名方案后再增加 Depot。

## 2. 同类产品与可借鉴做法

### GitHub / 开源实现

- [A Dark Room 桌面版](https://github.com/doublespeakgames/adr-desktop)：把网页文本冒险用 node-webkit 封装成原生桌面应用。它证明“成熟 Web 玩法 + 桌面壳”是低风险路线。
- [openovel](https://github.com/Feed-Scription/openovel)：本地优先的 AI 互动小说 Electron 应用，采用桌面故事库、内置示例内容和玩家自选模型供应商。适合参考首次启动、BYOK 配置和本地存档体验。
- [electron-builder](https://github.com/electron-userland/electron-builder)：用于生成 Windows/macOS/Linux 桌面分发包，并处理原生依赖与签名构建。
- [steam-electron-build](https://github.com/alexanderthurn/steam-electron-build)：展示把 HTML5/Web 游戏封装为 Electron Steam 构建，并接入 Overlay、成就、存档等能力的做法。可作为实现参考，不应未经审计直接成为强依赖。

### Steam 同类产品

- [AI Roguelite](https://store.steampowered.com/app/1889620/AI_Roguelite/)：文本 RPG，提供开箱即用、付费云模型和自定义 API 等多种模型路径。最值得借鉴的是“基础游戏不因额外订阅或 API 配置而失效”。
- [Vaudeville](https://store.steampowered.com/app/2240920/Vaudeville/)：实时 AI 对话驱动的叙事侦探游戏，商店页明确标注需要联网及 AI 生成内容。说明联网依赖必须在商店页和系统需求中直说。
- [Suck Up!](https://store.steampowered.com/app/2726370/Suck_Up/)：商店页明确披露第三方 ChatGPT 服务与实时 AI 交互，同时提供成就、云存档和创意工坊。说明 AI 服务来源与联网依赖可以公开透明地成为产品规格。

## 3. 两条上线轨道

### A. GitHub 预发行

目标：建立可审计、可复现的公开代码与玩家预览，不承诺普通玩家级安装体验。

发布内容：

- `release/staging/player-runtime/` 的白名单快照；
- `packages/dsh-feitu-world` 的 npm pack 产物；
- 版本说明、已知问题、许可证/版权边界；
- SHA-256 校验文件；
- 不包含小说全文、`analysis/`、`data/`、本地存档、API Key、评估 trace、缓存或整个上游源码树。

发布前条件：补齐项目本身的明确 LICENSE 和版权主体；确认可公开内容均有来源记录；在干净 Windows 用户环境完成一次启动与存档回归。

### B. Steam Playtest → 正式版

目标：先用 Steam Playtest 验证安装、启动、存档、联网失败和 AI 输出安全，再决定 Early Access 或正式版。

阶段顺序：

1. 注册 Steamworks、支付每个产品 100 美元 Steam Direct 费用，并完成税务/银行资料。
2. 完成 Electron Windows 构建；双击 EXE 后直接进游戏，不出现终端、PowerShell、Node 安装或 DSH 配置步骤。
3. 建立 Windows Depot，先上传密码保护分支和 Steam Playtest。
4. 配置 Steam Auto-Cloud，同步玩家存档而不是日志、密钥或图形设置。
5. 填写内容问卷，准确披露“实时生成式 AI”、所用外部服务、联网需求和防止违法/侵权输出的技术护栏。
6. 商店页先通过审核并至少保持 Coming Soon 两周；产品构建也需要通过 Valve 审核。
7. Playtest 数据达标后，再选择 Early Access 或完整发布。当前只有一个可玩副本，若商店宣传强调开放世界，建议先走 Playtest，而不是直接正式版。

Steam 官方依据：

- [发布流程](https://partner.steamgames.com/doc/store/releasing)
- [审核流程](https://partner.steamgames.com/doc/store/review_process)
- [测试与 Steam Playtest](https://partner.steamgames.com/doc/store/testing)
- [生成式 AI 内容问卷](https://partner.steamgames.com/doc/gettingstarted/contentsurvey)
- [Steam Cloud](https://partner.steamgames.com/doc/features/cloud)
- [Steam Direct 费用](https://partner.steamgames.com/doc/gettingstarted/appfee)

## 4. 当前阻断与优先级

### P0：上线前必须解决

1. **IP 权利**：当前故事、角色和设定来自小说改编。没有公开改编/商业发行授权时，只能发布通用引擎、原创 UI/规则或完成去 IP 化的原创替换版。
2. **独立 LICENSE**：`dsh-feitu-world` 声明 MIT，但包内没有项目自身的 LICENSE 文件和明确版权主体；发布前补齐。
3. **代码签名**：桌面候选包已经建立，但正式公开下载前仍应配置 Windows 代码签名，降低 SmartScreen 风险。
4. **Steamworks 实测**：已经生成可上传的 unpacked Depot 和 VDF 工具；仍需真实 App ID、Depot ID 和 Steam 客户端回归。
5. **密钥安全**：不把玩家 API Key 写入明文日志、存档或 Steam Cloud。推荐使用操作系统凭据存储；若做官方托管 AI，应由后端代理并采用 Steam 支持的付费方式。

### P1：Playtest 前完成

- 把存档目录迁移到稳定的用户数据目录，并验证旧存档迁移、冲突处理和 Steam Cloud。
- 加入崩溃日志导出、模型故障降级、网络超时/限流提示、隐私政策和数据删除说明。
- 为实时 AI 输出保留现有可见事实、角色权限、选择白名单、状态二次校验，并增加违法/侵权/个人信息输出过滤与举报入口。
- 准备商店胶囊图、至少 5 张真实玩家画面、预告片、中文/英文短描述和系统需求。
- 只宣传构建中真实存在的功能；当前不要把 10 个 `ANNOUNCED` 区域写成已可玩开放世界。

### P2：正式版前完成

- Steam 成就、控制器导航、Deck 兼容性评估、云存档跨版本恢复。
- Demo 与正式版共用存档方案；更多副本或明确标注当前内容体量。
- 代码签名、自动化干净机安装测试、回滚分支和发行后更新流程。

## 5. 建议验收线

进入 Steam Playtest 前至少满足：

- 全新 Windows 10/11 用户双击安装后 60 秒内进入主界面；
- 不安装 Node/PowerShell 模块/DSH/SillyTavern 也能运行；
- 无 API Key、断网、API 429/500 时仍能进入和保存基础流程；
- 连续游玩 60 分钟无状态损坏，重启后可恢复；
- 包内扫描不到小说全文、密钥、测试 trace、本机绝对路径和开发缓存；
- Steam Deck/控制器未验证前，商店页不勾选相应支持；
- Steam 内容问卷与游戏内实际 AI 行为一致。

## 6. 推荐商业方案

首版采用“一次购买 + 离线确定性玩法 + 玩家自带 API Key 的可选增强”最容易控制成本。不要在首发时承诺无限官方云 AI。若后续提供官方托管模型额度，应先设计成本上限、地区可用性、隐私条款和 Steam Wallet 合规的 DLC/订阅/微交易方案。
