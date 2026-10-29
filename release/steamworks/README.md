# Steamworks 文件区

`generated/` 由 `desktop/electron/scripts/generate-steam-vdf.mjs` 创建。VDF 只记录 App ID、Depot ID、文件映射、测试分支和预览开关，不保存 Steam 用户名、密码或令牌。

```powershell
cd desktop/electron
npm.cmd run steam:vdf -- --app-id <APP_ID> --depot-id <DEPOT_ID> --branch beta --preview 1
```

安全发布顺序：

1. 先运行 `release:steam` 和 `release:verify`。
2. 保持 `preview=1` 检查 SteamCMD 文件映射。
3. 改为 `preview=0`，上传到 beta 或 Playtest 分支。
4. 在 Steam 客户端执行安装、启动、存档、断网和升级回归。
5. 仅在 Steamworks 后台手动把已验收构建提升到默认分支。

脚本会拒绝把 `default` 或 `public` 作为自动 `setlive` 目标。旧 `.template` 文件保留作人工参考，自动流程以 `generated/` 为准。

Steam Auto-Cloud 的精确 Root、子目录、文件掩码和双机验证步骤见 `CLOUD_SETUP.md`。
