# dsh-feitu-world

An out-of-tree DeepSeek Harness / Cordis plugin for the first playable Feitu
World dungeon, “消失的一号线末班车”. It exposes one deterministic model-facing
tool, `feitu_game`, and keeps canon state outside the language model.

Install from the repository root with `dsh plugin add ./packages/dsh-feitu-world`.

To verify the local Harness without making a model request, run
`npm.cmd --prefix packages/dsh-feitu-world run probe:dsh`. The evaluator accepts
`DSH_BIN` (a command or entry-file path) and `DSH_ROOT` (an unpacked DSH root);
it only falls back to the global npm installation when those are not set. The
user-provided `E:\shixi_temp\DSH` path is currently an unrelated
`daily recommend` workspace, so it is not auto-selected as a Harness root.

After the isolated profile dependencies are installed, run
`npm.cmd --prefix packages/dsh-feitu-world run verify:dsh-plugin` to verify that
the `headless` profile actually composes the `dsh-feitu-world` bundle and
`feitu-world` plugin id. This command uses `DSH_HOME` (defaulting to the ignored
workspace `.dsh-acceptance` directory), only calls `--dump-config`, and never
requires or transmits an API key.

To create the reproducible isolated profiles without installing anything, run
`npm.cmd --prefix packages/dsh-feitu-world run setup:dsh`. Add `-- --install`
only when dependency installation is explicitly desired; the command never
uses the unrelated `E:\shixi_temp\DSH` directory as a fallback.

The release roadmap and gate status live in [`DSH_ECOSYSTEM_ROADMAP.md`](../../DSH_ECOSYSTEM_ROADMAP.md).

## Player-view preview

The DSH shell remains the primary product surface. For offline, player-perspective
acceptance (including when no DeepSeek API key is configured), run
`npm run preview` in this package and open `http://127.0.0.1:3091/`. The preview
calls the same runtime used by `feitu_game`; it is not a second rules engine.
Host integrations can call `/api/health` and `/api/manifest` before showing the
player UI; `npm.cmd --prefix packages/dsh-feitu-world run verify:preview` checks
those endpoints and the public hidden-state boundary without a model request.
The `world_view` action and the preview's “世界枢纽” button expose only the
source-registered regions and playable dungeons, providing the open-world hub
without inventing undisclosed areas.
Pass the returned `dungeon_id` as `dungeon_id` to `start`; unregistered or
non-playable ids fail closed before a run is created.

For community expansion authoring, see the repository's
[`WORLD_EXTENSION_AUTHORING_GUIDE.md`](../../WORLD_EXTENSION_AUTHORING_GUIDE.md)
and the packaged `content/world-extension-contract.json`. The extension gate
keeps announced entries catalog-only until a source-backed content manifest and
runtime acceptance suite exist.
It also audits a PLAYABLE manifest and runs a negative test that rejects path
escape and hidden-state fields before an extension can be trusted.

## Acceptance and content gates

```powershell
npm.cmd --prefix packages/dsh-feitu-world test
npm.cmd --prefix packages/dsh-feitu-world run test:player-cases
npm.cmd --prefix packages/dsh-feitu-world run test:dsh-eval
npm.cmd --prefix packages/dsh-feitu-world run compile:author -- --check
npm.cmd --prefix packages/dsh-feitu-world run verify:pack
npm.cmd --prefix packages/dsh-feitu-world run verify:security
npm.cmd --prefix packages/dsh-feitu-world run verify:ci
npm.cmd --prefix packages/dsh-feitu-world run verify:release
```

The first command runs the deterministic runtime/PVA suite and the source/OOC
content audit. The second runs the player-view case adapter inspired by
[`dsh-eval-harness`](https://github.com/BiBoyang/dsh-eval-harness); cases are
stored in `simulation/game_design/implementation/DSH_PLAYER_ACCEPTANCE_CASES.json`
and only assert public views or fail-closed errors. `export_log` provides a
replayable intent log without hidden world state.

Replay an exported log with `npm run replay:action-log -- path/to/log.json`;
the command feeds only the recorded player actions back into the same runtime.

The runtime also carries the source-backed pressure clock (`38/100` starting
contamination, `80` action window). Player View exposes only the phase, reading,
countdown, communication state, and NPC status summary (徐萌 plus the
data-gated 林岚 contact); internal consequence queues and NPC plan progress
remain hidden.

Source-defined recovery windows (for example `RW_003_ZN_STABILIZATION`) are
shown as player summaries and are closed only by the corresponding protection
or delay choice.

The offline preview exposes the same player actions as the tool—inspect, move,
take/use, save/load, and fork—through semantic buttons, so a browser run can
exercise the full item and recovery loop without a developer panel.
It also exposes a free-action box. The browser sends `action=free_action` with
the player's text; when `DEEPSEEK_API_KEY` is present in the current process,
the server asks DeepSeek to select a currently visible branch and return an
event description. The runtime validates the proposed intent against the
frozen map, role, facts, choices, and inventory before applying it. Without a
key, the same contract uses the deterministic local interpreter and labels the
event as a fallback. The DSH `feitu_game` tool uses the same adapter before it
applies a free action, so actions submitted through the Harness shell and the
offline preview follow one event pipeline. Inside DSH, the adapter resolves
`DEEPSEEK_API_KEY` through the Harness credentials service first; the browser
preview reads the environment of the process that launches it. On Windows,
configure `DEEPSEEK_API_KEY` as a user environment variable, open a new
terminal, and then start the preview. The startup log and `/api/health` expose
only whether a key is configured; they never return the key itself.
The map is a local generated infinity-loop background
(`ui/dungeon-map-infinity.png`) with HTML marker layers, so the train is
visually a nose-to-tail ∞ route with no terminal station. Role selection drives
the half-body portrait above the scene. The right rail is a first-person sealed
helmet panel backed by `ui/helmet-hud-source.png`; its pollution,
communication, oxygen, suit-integrity, temperature, countdown, inventory, and
verified-facts readings are embedded as live HTML data, not baked into the
image. The source-to-visual mapping is recorded in `HEADSET_HUD_SOURCE_NOTES.md`.
After a service restart, the empty state lists persisted `run_id` values and
lets the player explicitly resume one; it never silently picks a save.
Persisted snapshots carry a `feitu-world/save/v1` marker; legacy snapshots are
migrated in memory, while hash mismatches and malformed files fail closed.

The content package is versioned in
`content/one-line-last-train.content.json`; its source references and OOC
boundaries are checked by `npm run audit:content` before release.

`verify:pack` runs a real `npm pack --dry-run` audit and checks the release
manifest, required assets, package entry count, and forbidden-content boundary.
`verify:security` scans text sources for API-key-shaped values; credentials must
remain process/CI-secret inputs and are never part of the content package.
`verify:ci` checks that the GitHub workflow still contains every local player,
release, secret, trace, baseline, and artifact gate.
`verify:completion` performs the repository-level completion audit and reports
local evidence separately from the still-pending trusted external trace.
`verify:release` is the one-command offline release gate; it runs the twelve
local checks (including reproducible workspace setup, the preview host and
accessibility contracts, and the world extension contract) and explicitly reports
that the remote DSH trace was not run.

Authoring adapters target `feitu-author-graph/v1`: `compile:author` combines the
Ink/Yarn-compatible author source with the frozen route/choice/event sources and
emits only nodes, choices, events, and annotations. It cannot write runtime
state or Player View fields.
The adapter smoke test accepts the restricted Ink knot/Yarn node metadata format
and rejects runtime mutation tokens before compilation.

`test:dsh-eval` uses the official `dsh-eval-harness` runner from an isolated
profile and drives real DSH sessions. Set `DSH_HOME`, `DSH_BIN` (or `DSH_ROOT`),
and `DEEPSEEK_API_KEY` in the current process before running it; reports are
written to `.dsh-eval/` and are intentionally excluded from the package and
source control. CI enforces the secret for trusted push/manual runs; untrusted
pull requests without a secret still run every local player/content/package
gate and report the external trace as intentionally skipped.
# 一键启动本地预览（Windows）

双击 `一键启动预览.cmd`。它会以普通 PowerShell 进程启动预览、在未配置密钥时隐藏输入 DeepSeek API Key，并自动打开浏览器。密钥只用于本次进程，不会写入项目或系统环境变量。

请从 Windows 资源管理器直接双击启动，不要从 Codex 内置终端运行。Codex 的网络沙箱会由子进程继承，表现为 DeepSeek 请求返回 `EACCES` / `DEEPSEEK_NETWORK_BLOCKED`；启动脚本现在会检测这种环境并直接给出提示。启动器和 PowerShell 启动逻辑均使用无 BOM 的纯 ASCII 文本，以兼容 Windows PowerShell 5.1。

若 3091 端口被占用，请在普通 PowerShell 中运行：

```powershell
cd 'E:\研究生\计算语言学\codex\feitu_world\packages\dsh-feitu-world'
.\start-preview.ps1 -Port 3092
```

## 剧情文风与人物一致性

自由行动和可见按钮生成的剧情共用 lib/narrative.js 的原文适配约束，参照第3、4章及人物表达档案。生成请求携带人物动机、关系阶段与知情边界；正文使用第三人称限知、具体动作、自然口语和适量冷幽默，不能用凭空恶化、迷路或通讯中断制造悬念。原文参照不授权提前揭示后续剧情。

在线事件必须返回完整的 narrative_check；缺失或任一项为 false 时，丢弃提案并由本地行动流程接管。已有的前情矛盾检查与运行时行动校验继续生效，拒绝的动作不再展示模型拟写的成功标题或正文。本地摘要也不再冒充角色台词。模型自检是附加门禁，不是独立的文学质量评审，也不能保证完全消除 OOC。

重启预览服务后，新生成的剧情使用这些约束；已保存的旧段落不会自动重写。测试使用本地模拟模型接口，覆盖约束传递、自检缺失/失败、前情冲突和拒绝动作的展示边界。
