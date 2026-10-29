# 《废土末班车》玩家启动与模型接入说明

> 当前 Windows 玩家入口是 Electron 桌面包。下方 DSH 和 Narrative Engine 说明只供开发、兼容与研究使用，不是桌面版操作步骤。

## Windows 桌面版

解压完整的 Windows 发行 ZIP 后，双击 `FeituWorld.exe`。不要单独移动 EXE，也不要在 ZIP 内直接运行。无需安装 Node.js、PowerShell、DSH 或 SillyTavern；没有模型密钥也能使用离线规则与剧情。

打开菜单“游戏 → 在线剧情与数据设置…”或按 `Ctrl+,`，选择连接方式：

- **仅离线**：下次重启后关闭在线 AI，即使启动器或本机保存了密钥也不会启用。
- **沿用启动器**：兼容启动进程中的 `DEEPSEEK_API_KEY`、`DEEPSEEK_MODEL` 和 `DEEPSEEK_API_BASE_URL`；没有密钥时离线运行。
- **使用本机密钥**：填写自己的密钥、模型和完整 HTTPS 聊天接口地址，覆盖启动器配置。默认模型为 `deepseek-chat`，默认地址为 `https://api.deepseek.com/chat/completions`，不能只填基础域名。

点击“保存设置”不会发出模型请求或自动重启。请等待当前行动完成，再点“重启游戏”应用设置。密钥是否有效、账户是否有额度，要到实际使用在线行动时才能确认；模型服务可能收费。

本机密钥经系统加密保存在 `%APPDATA%\FeituWorld\model-settings.json`，密码框不会回填；已有密钥时留空保存会保留。加密保护依赖当前 Windows 账户，不能防止同账户中的恶意程序。文件不要上传、分享或放进云存档；加密不可用或解密失败时，游戏保持离线，请在设置中重新输入或改选离线。

在线行动会将玩家输入、当前可见剧情及必要游戏上下文发送到所填服务，密钥用于请求认证。仅向你信任的服务配置密钥，并遵守服务商的隐私政策与使用条款。“删除本机密钥”不更改启动器的环境变量；如需完全停止在线请求，请选择“仅离线”并重启。

菜单“帮助”与设置窗口均可打开存档和日志文件夹。存档位于 `%APPDATA%\FeituWorld\saves`，日志位于 `%APPDATA%\FeituWorld\logs`；升级或更换 Steam/便携版时保留此目录，安装目录不保存玩家进度。

## 当前 DSH 入口

```powershell
npm.cmd --prefix packages/dsh-feitu-world test
npm.cmd --prefix packages/dsh-feitu-world run setup:dsh
npm.cmd --prefix packages/dsh-feitu-world run preview
# http://127.0.0.1:3091/preview.html
```

浏览器预览读取启动进程的环境变量。Windows 上请将 `DEEPSEEK_API_KEY` 配为当前用户环境变量，
再新开终端启动预览；启动日志会显示 `FEITU_DEEPSEEK configured`，`/api/health` 仅返回非敏感的
`deepseek.configured` 状态。不要把密钥写入仓库、文档或截图。

在 DSH 中可先调用 `feitu_game` 的 `world_view` 查看已登记区域、可玩副本和来源登记的未开放目录，再用
返回的 `dungeon_id` 调用 `start` 进入《消失的一号线末班车》；未登记或不可玩的副本会在开局前拒绝，未登记区域不会被叙事层自动补写。

预览界面中的“自由行动”输入框对应 `feitu_game(action=free_action, action_text=...)`。
DeepSeek 可以在当前玩家可见事实、可见选择和已登记地图连接内决定事件分支、生成 `story_segment` 并返回受控事态变化；模型必须声明 `actor_id`，运行时会再次校验行动主体、分支、读数与事实边界，禁止模型直接改写污染、背包、隐藏计划或事实台账。成功事件会以 `freeActionEvent.storySegment` 持久化为“剧情已解锁”正文，`systemLines` 仅作为次级审计回执；前端和 DSH `feitu_game` 工具共用同一个事件适配器。自由行动还支持 `client_action_id` 幂等去重、`expected_turn` 过期写入拒绝和 `run_id` 存档隔离。DSH 壳内优先从 credentials service 解析 `DEEPSEEK_API_KEY`，无 credentials service 时才回退到当前进程环境变量；预览服务器使用当前进程环境变量。未配置时会明确标记并使用同一协议的本地安全解释器。

DSH 需要真实模型时，在当前进程注入 `DEEPSEEK_API_KEY`，不要写入仓库；官方 trace 验收使用
`npm.cmd --prefix packages/dsh-feitu-world run test:dsh-eval`，并由 CI 的结构化 baseline gate 复核。

先做不联网的 Harness 检查：

```powershell
npm.cmd --prefix packages/dsh-feitu-world run probe:dsh
npm.cmd --prefix packages/dsh-feitu-world run verify:dsh-plugin
npm.cmd --prefix packages/dsh-feitu-world run verify:pack
npm.cmd --prefix packages/dsh-feitu-world run verify:security
npm.cmd --prefix packages/dsh-feitu-world run verify:preview
npm.cmd --prefix packages/dsh-feitu-world run verify:ci
npm.cmd --prefix packages/dsh-feitu-world run verify:release
```

若使用本地解压版 DSH，可设置 `DSH_ROOT`（目录内应有 `lib/bin.js`），或直接设置
`DSH_BIN`；评估器不会把任意名为 `DSH` 的业务目录当作 Harness。上述 DSH 开发命令需要单独准备 Harness，Electron 玩家包无需这些工具。

版本：DSH 0.2.2 · 文档日期：2026-08-18
运行形态：本地 Web 应用（React/Vite 前端 + Express 后端）
底座：Narrative Engine 1.0.4（固定上游提交 `3c3ed4f503da55db0e2498f3b830619ef0b2e842`）

---

## 一、一键启动

### Windows

双击 `Start_Feitu_Last_Train.bat`，或命令行执行：

```bash
node start-feitu.mjs
```

启动器会：

1. 自动探测与 `better-sqlite3` 原生模块 ABI 兼容的 Node 运行时（本机为 Node 24）；
2. 启动 Express 后端（端口 3001）与 Vite 前端（端口 5173）；
3. 等待端口就绪后自动打开浏览器 `http://localhost:5173/`；
4. 将前后端标准输出/错误写入 `data/logs/server-<时间戳>.log` 与 `data/logs/vite-<时间戳>.log`；
5. 关闭启动器窗口即同时停止前后端服务。

### 启动失败排查

| 现象 | 处理 |
| --- | --- |
| 提示"未找到可用的 Node 运行时" | 安装 Node.js 24 LTS，或运行 `Repair_Narrative_Engine.bat` 重建数据库模块 |
| 后端启动超时 | 查看 `data/logs/server-*.log` |
| 前端启动超时 | 查看 `data/logs/vite-*.log` |
| 端口被占用 | 关闭占用 3001/5173 的进程后重试（启动器会自动尝试释放） |

---

## 二、进入"废土末班车"战役

1. 打开 `http://localhost:5173/`；
2. 首页会显示战役卡片 **「废土末班车：消失的一号线」**；
3. 点击 `ENTER — 废土末班车：消失的一号线` 进入战役，直接开始第一回合。

无需手工创建空战役。初始战役包位于 `feitu_campaign/`，重新导入命令：

```bash
node feitu_campaign/import-feitu-campaign.mjs --yes
```

---

## 三、模型接入

### 3.1 需求

叙事生成需要接入一个 OpenAI 兼容（或 Anthropic / Gemini）的 LLM 端点。
未配置模型时，聊天区仍可打开，但回合生成会失败——只有配置模型后才能游玩。

### 3.2 推荐：Ollama 本地模型（零成本）

1. 安装 [Ollama](https://ollama.com/)；
2. 拉取一个中文能力较好的模型，例如：

   ```bash
   ollama pull qwen2.5:7b
   ```

3. 打开游戏 → 右上角 `SETTINGS` → `Providers`，确认默认 Provider：
   - Endpoint：`http://localhost:11434/v1`
   - Model：`qwen2.5:7b`（或你拉取的模型名）
4. 保存后即可开始游玩。

> 注意：默认 Provider 已指向 `http://localhost:11434/v1`，若你本地已有 Ollama，
> 只需把模型名改成已安装的模型即可。

### 3.3 使用云端 API（OpenAI 兼容）

在 `SETTINGS` → `Providers` 中新增 Provider：

| 字段 | 示例 |
| --- | --- |
| Endpoint | `https://api.deepseek.com/v1` |
| API Key | 你的密钥（仅存于浏览器 IndexedDB，不上传服务器） |
| Model | `deepseek-chat` |

### 3.4 无向量模型（无检索）模式

本地 Embedding 模型（`mxbai-embed-large-v1`）预热失败**不会阻止游戏启动**。
未加载 Embedding 模型时，Lore/Rules 以"关键字匹配"方式注入，基础玩法不受影响。
启动日志中出现的 `[Embedder] Warmup failed` 与 `[TTS] Warmup failed` 为**非致命警告**。

---

## 四、末班车控制台

进入战役后，顶栏出现 **「末班车」** 按钮，点击打开控制台（独立沙箱 iframe）：

- 当前角色与压力（生命 / 信任 / 污染 / 通讯）
- 副本现场（阶段 / 位置 / 回合 / 剩余时间）
- 线索状态与 NPC 意图
- 五条结局路线风险
- 结局锁定提示（触发后显示结算文案）
- 状态编辑、事件记录、JSON 导出

---

## 五、数据与存档

| 内容 | 位置 |
| --- | --- |
| 战役元数据 | `data/campaigns/<id>.json` |
| 回合状态 | `data/campaigns/<id>.state.json` |
| Lore/Rules | `data/campaigns/<id>.lore.json` |
| NPC 台账 | `data/campaigns/<id>.npcs.json` |
| 模组状态表 | `data/campaigns/<id>.mod-feitu-last-train-*.json` |
| API 密钥 Vault | `data/apikeys.vault`（本机加密，启动自动解锁） |
| 日志 | `data/logs/*.log` |

刷新页面、关闭浏览器、重启服务后，已提交回合均保留。

---

## 六、五类结局

| 结局 | 触发要点 |
| --- | --- |
| 环境净化 | 定位车外核心 + 理解循环列车规则 + 确认析孢真死判据，祝宁存活 |
| 隐藏救援 | 通讯开启 + 制造脱离窗口 + 林岚高信任（≥60） |
| 净化成功但祝宁死亡 | 净化条件满足但祝宁生命归零 |
| 净化失败但逃脱 | 制造脱离窗口但未确认析孢 |
| 永久困局 | 场域崩塌（时间耗尽或污染 ≥95）且无脱离窗口 |

多结局同时满足时按公开优先级（环境净化 > 隐藏救援 > 净化成功但祝宁死亡 > 净化失败但逃脱 > 永久困局）结算。结局锁定后世界线冻结。
