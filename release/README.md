# 《废土末班车》发行工作区

此目录只承载构建、验证和上线所需文件；研究资料与开发源码不应直接上传。

实际发布前逐项执行 `RELEASE_CHECKLIST.md`；玩家可见版本变化记录在仓库根目录 `CHANGELOG.md`。

## 文件分区

| 目录 | 用途 | 是否直接上传 |
| --- | --- | --- |
| `staging/steam-windows/` | 当前已验证的 Windows x64 Steam Depot 内容 | 是，上传这个目录 |
| `staging/player-runtime/` | 桌面包内嵌的玩家运行时白名单快照 | 否，已包含在桌面包中 |
| `artifacts/` | 版本清单、体积与构建元数据 | 留档，不作为 Depot 内容 |
| `steamworks/generated/` | 用真实 App/Depot ID 生成的 SteamPipe VDF | 交给 SteamCMD，不含凭据 |
| `manifests/` | 哪些源码可进入玩家运行时的白名单规则 | 否 |
| `build/` | Electron 临时构建、下载缓存和中间文件 | 否，可重建、已忽略 |
| `test-data/` | 烟测和脚本试运行数据 | 否，可重建、已忽略 |

桌面源码在 `desktop/electron/`，游戏规则与内容源在 `packages/dsh-feitu-world/`。不要把整个仓库、`node_modules/`、研究语料、存档、日志或 API Key 上传到 Steam。

## 标准更新流程

```powershell
cd desktop/electron
npm.cmd run version:set -- <新版本>
npm.cmd run release:steam
npm.cmd run release:verify
npm.cmd run steam:vdf -- --app-id <APP_ID> --depot-id <DEPOT_ID> --branch beta --preview 1
```

先用 SteamCMD 预览，再把 `preview` 改为 `0` 上传 beta/Playtest 分支。验收通过后只在 Steamworks 后台手动提升到默认分支，以保留回滚能力。

## 当前状态

`release/staging/steam-windows/` 是当前权威候选包，版本 0.2.3、约 381.28 MiB、120 个文件，SHA-256 和当前源码摘要复核通过。公开发行仍需要代码签名证书、真实 Steamworks ID/账号配置，以及改编/商业发行权和项目 LICENSE。

GitHub 便携包位于 `release/artifacts/FeituWorld-0.2.3-windows-x64.zip`，约 164.03 MiB；其归档哈希和解压后的 120 个文件均已复核。0.2.2 ZIP 保留作历史版本。所有 staging、ZIP、校验文件和候选清单都是可重建生成物，已由 `.gitignore` 排除。
