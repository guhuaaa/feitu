# 《废土末班车》Electron 发行壳

这是玩家可直接启动的 Windows x64 桌面版本。Electron 启动包内本地运行时，等待 `/api/health` 通过后打开游戏；玩家不需要安装 Node、PowerShell、DSH 或 SillyTavern。

## 发行边界

- 规则与内容真值源：`packages/dsh-feitu-world/`
- 玩家运行时快照：`release/staging/player-runtime/`
- Steam 可上传目录：`release/staging/steam-windows/`
- 构建清单：`release/artifacts/FeituWorld-<version>-steam-win-x64.json`
- 存档：Electron `userData/saves`，与安装目录分离
- 日志：Electron `userData/logs/desktop.jsonl`，2 MiB 轮换一次
- 在线配置：`userData/model-settings.json`；本机密钥使用系统异步加密 API，不进入 `saves` 或发行文件
- 更新策略：Steam 版交给 SteamPipe；先测试分支，再在 Steamworks 手动提升到默认分支

## 日常命令

```powershell
cd desktop/electron
npm.cmd install
npm.cmd run verify
npm.cmd run test:release
npm.cmd start
npm.cmd run release:steam
npm.cmd run release:verify
npm.cmd run release:github
npm.cmd run release:github:verify
npm.cmd run release:smoke -- --channel steam
npm.cmd run release:smoke -- --channel github
```

修改版本时只运行一次：

```powershell
npm.cmd run version:set -- 0.2.5
```

它会同步桌面包、锁文件、玩家运行时和发行清单的版本。`release:steam` 会执行运行时打包审计、秘密扫描、白名单快照、Windows 构建、构建信息和 SHA-256 清单。`release:verify` 会重新读取候选包并逐文件复核。

`verify` 直接检查源码，可在没有 staging 的全新 checkout 中运行。`test:release` 覆盖首次构建、签名误判、产物替换失败和存档迁移重试。两个渠道都先生成并验证临时候选，再替换现有产物；可捕获的替换失败会恢复原目录和清单。

清单中的 `sourceFingerprint` 绑定当前发布白名单、桌面源码与构建脚本。如果源码改变，即使版本号相同也必须重新运行 `release:steam`。`codeSigned` 使用 Windows Authenticode 验证；设置 `FEITU_REQUIRE_CODE_SIGNING=1` 可拒绝未通过签名验证的候选包。

## 玩家设置与密钥

主窗口菜单“游戏 → 在线剧情与数据设置…”（`Ctrl+,`）打开独立的本地设置窗口。主游戏页面仍不加载 preload；设置页仅能调用固定的配置、重启和存档/日志目录操作，主进程校验窗口、主 frame 及精确页面 URL。

默认 `environment` 模式保留已有启动环境；`offline` 显式移除服务进程的 API Key；`saved` 使用本机加密密钥及已验证的模型/完整 HTTPS 接口覆盖启动环境。空密钥保留旧值，删除 `saved` 密钥后切换离线。保存不自动重启、不发模型请求；启动时无法读取或解密配置则清除子进程密钥并降级离线，原配置保留以供恢复。

`release:smoke` 使用隔离用户目录和假密钥，覆盖实际表单提交、系统加密读回、密码不回填、窗口隔离和删除后离线，并输出设置窗口截图。`--development` 可检查源码窗口，但需已有 player-runtime staging 且本机 Electron 目录允许 Windows 应用沙箱读取；成品验收仍必须检查两个实际渠道包。测试不会请求在线模型，也不会改真实玩家设置。

## 连续界面验收

```powershell
npm.cmd run release:soak -- --channel steam --minutes 1
npm.cmd run release:soak -- --channel steam --minutes 60
```

先以 1 分钟检查流程，再做 60 分钟正式长测；`--development` 只用于源码试运行，不能当作成品验收。命令只启动已校验的当前候选包，以独立临时用户目录强制离线，通过真实控件在同一局内走完六个地点、收集三件物品、交替角色并到达 END_01，期间查看地图/头盔、保存和恢复检查点，结局后才重开。最后退出并再次启动，按 15 个关键字段摘要核对恢复状态。无需操作标有“稳定性测试”的窗口。

命令每 15 秒采样自己启动的 EXE 及子进程，输出版本/渠道/时长对应的 JSON 和起止/恢复截图到 `release/artifacts/`。报告记录源码摘要、ASAR 和校验清单摘要，结束时复核包未改变，并要求地点、物品、终局及同局回合覆盖通过。总工作集可能重复计入共享页，私有字节是提交量，不是驻留内存；采样峰值也不是连续监测峰值。短测不会标为满足 60 分钟，失败保留隔离证据，成功后清理临时测试目录。

Windows 权限限制应与应用失败区分；Codex 沙箱内若发生安装资源读取错误，应在获准的正常 Windows 上下文运行同一命令，不关闭 Electron 沙箱或改系统权限。离线自动长测不替代干净 Windows 10/11、真实在线服务、Steam 客户端和双机 Cloud 验收。

## SteamPipe VDF

拿到真实 App ID 和 Depot ID 后：

```powershell
npm.cmd run steam:vdf -- --app-id <APP_ID> --depot-id <DEPOT_ID> --branch beta --preview 1
```

生成文件位于 `release/steamworks/generated/`。默认只做 SteamCMD 预览；脚本拒绝自动推送 `default/public` 分支，也不会保存 Steam 登录凭据。确认预览后将 `--preview 0`，仍先上传测试分支。

## 当前资源预算

- 0.2.5 Windows 解压目录：381.34 MiB；GitHub ZIP 164.05 MiB
- Steam/zip 下载量估计：约 145–210 MiB，最终以 SteamPipe 报告为准
- 0.2.5 本机 60 分钟离线长测通过；238 次采样的进程总工作集峰值 688.94 MiB、私有提交量峰值 399.62 MiB。工作集可能重复计共享页，私有提交量不是驻留物理内存。
- 系统最低内存仍需干净 Windows 环境确认，长测采样不能直接作为商店最低配置。

当前包已有原创应用图标、持久日志、崩溃记录、权限默认拒绝和构建版本校验，但仍未代码签名。公开商业发行还受改编权与项目许可证闸门约束。

## GitHub 便携预发行

`release:github` 从已经验证的桌面候选包创建独立的 GitHub 渠道目录和 ZIP；`release:github:verify` 会把最终 ZIP 解压后逐文件复核。产物名为 `release/artifacts/FeituWorld-<version>-windows-x64.zip`，历史版本 ZIP 保留在 `release/artifacts/`。

`.github/workflows/desktop-release.yml` 只在手动触发时运行。默认只构建和校验，不上传游戏文件；勾选 `upload_test_artifact` 才会上传可下载的 Actions 测试附件，公开仓库的已登录读者可能下载这些附件。`create_draft_release` 单独控制草稿预发行，默认关闭。

## 真实发行包升级验收

保留上一稳定版本的 ZIP 和 `.zip.sha256` 后，从本目录执行：

```powershell
node ../../tools/verify-desktop-upgrade.mjs --from 0.2.4 --to 0.2.5
```

该命令解压两版发行包，用各包内置的 Electron/Node 运行各自的游戏服务，验证旧档恢复、新版保存重启、回退读取以及一个离线结局。使用隔离存档目录并清除 API Key；不替代窗口交互、Steam 安装更新和双机 Cloud 测试。0.2.2 → 0.2.3、0.2.3 → 0.2.4 和 0.2.4 → 0.2.5 均已通过，验收报告随版本保存在 `release/artifacts/`。
