# Steam Auto-Cloud 配置

桌面版把玩家存档固定在 Windows Roaming AppData 的 `FeituWorld/saves`。Steam 与 GitHub 渠道使用同一目录；日志、Chromium 缓存和崩溃数据不参与同步。

## Steamworks 后台配置

在 App Admin → Steam Cloud 中设置合理的单用户字节配额和文件数配额，然后新增一条 Auto-Cloud Root：

| 字段 | 值 |
| --- | --- |
| Root | `WinAppDataRoaming` |
| Subdirectory | `FeituWorld/saves` |
| Pattern | `*.json` |
| OS | Windows |
| Recursive | 关闭；当前存档为单层 JSON 文件 |

不要配置 `FeituWorld/logs`、整个 `FeituWorld` 目录或游戏安装目录。Steam 官方说明 Auto-Cloud 会在游戏退出后上传匹配文件，并在另一台电脑启动游戏前下载；配置依据见 [Steam Cloud 官方文档](https://partner.steamgames.com/doc/features/cloud?l=english&language=english)。

## 上线前验证

1. 先启用仅开发者测试模式，不直接向所有玩家开放。
2. 使用拥有 Developer Comp 许可的账号登录 Steam。
3. 在 Steam Console 执行 `testappcloudpaths <APP_ID>`，确认解析结果指向 `%APPDATA%\FeituWorld\saves`。
4. 启动游戏并生成存档，正常退出，确认 Steam 完成上传。
5. 在另一台 Windows 电脑安装同一 beta/Playtest 构建，确认启动前下载且游戏可恢复存档。
6. 制造同一存档的双机冲突，确认 Steam 客户端提示与团队预期一致。
7. 测试完成后执行 `testappcloudpaths 0`，再发布 Cloud 设置。

当前只支持 Windows，因此不要提前配置 macOS/Linux Root Override。未来加入其他平台时，应先实现并验证相同存档 schema，再增加 Root Override。
