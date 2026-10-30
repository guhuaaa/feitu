# 桌面版本发布与回滚清单

每次 Steam 或 GitHub 对外发布都复制本清单到对应版本记录中，逐项确认。未满足“公开闸门”时只能生成本地候选包或私有草稿。

## 1. 公开闸门

- [ ] 改编与商业发行权已经书面确认。
- [ ] 版权主体、项目 LICENSE、隐私政策和 AI 内容披露已经确认。
- [ ] Steam 商店描述只声明当前构建中真实存在的功能。
- [ ] Windows Authenticode 证书有效，`codeSigned` 为 `true`。

## 2. 版本与构建

```powershell
cd desktop/electron
npm.cmd run version:set -- <新版本>
npm.cmd run release:steam
npm.cmd run release:verify
npm.cmd run release:smoke -- --channel steam
npm.cmd run release:github
npm.cmd run release:github:verify
npm.cmd run release:smoke -- --channel github
```

- [ ] `CHANGELOG.md` 已加入本版本玩家可见变化和已知问题。
- [ ] 桌面、运行时、锁文件和 release manifest 版本一致。
- [ ] 秘密扫描、运行时打包审计和候选包校验通过。
- [ ] 当前版本运行时/玩家验收测试通过，包括旧存档迁移、完整性失败关闭和跨实例恢复；私有原作比对缺失时只允许该单独审计项显式跳过。
- [ ] 两个渠道烟测均出现 `desktop_start`、`runtime_ready`、`desktop_ready`，退出码为 0。
- [ ] 保留上一稳定版 ZIP 与校验文件，执行真实包存档升级验收并保存报告：`node ../../tools/verify-desktop-upgrade.mjs --from <旧版本> --to <新版本>`。
- [ ] 旧档关键状态、新版再次保存和重启恢复通过；若宣称支持二进制回退，上一版本读取新档也须通过。
- [ ] 在干净 Windows 10/11 用户环境完成启动、保存、退出和恢复测试。
- [ ] 同一最终成品完成 60 分钟完整路线及独立重启恢复；报告绑定成品摘要、`status: PASS` 且 `meets60MinuteDuration: true`。

## 3. Steam 发布

- [ ] 用真实 App ID/Depot ID 生成 VDF，第一次保持 `preview=1`。
- [ ] 核对 SteamCMD 文件映射，不包含日志、存档、密钥、研究资料或开发缓存。
- [ ] 将 `preview` 改为 `0`，只上传 beta 或 Playtest 分支。
- [ ] 从 Steam 客户端全新安装并验证启动、断网、AI 服务失败和存档恢复。
- [ ] Steam Auto-Cloud 只同步 Electron `userData/saves`。
- [ ] 记录当前稳定 Build ID 和新 Build ID。
- [ ] 验收通过后，在 Steamworks 后台手动提升；不由脚本自动推默认分支。

## 4. GitHub 预发行

- [ ] GitHub Actions 的 Windows Artifact 构建和最终 ZIP 复核通过。
- [ ] 先以默认仅校验模式执行远端构建；确认测试包上传授权后，才勾选 `upload_test_artifact` 提供可下载附件。
- [ ] 核对 `.zip.sha256` 与 Release 附件一致。
- [ ] 先创建 Draft Prerelease，人工检查标题、变更说明和已知问题。
- [ ] 未签名构建不得作为面向普通玩家的正式公开下载。

## 5. 回滚

- Steam：在 Steamworks 将默认分支重新指向上一个稳定 Build ID；不要重新上传旧文件冒充新构建。
- GitHub：将问题版本标记为 prerelease/撤下附件，恢复上一稳定 Release 为推荐版本。
- 存档：禁止回滚时删除或覆盖 Electron `userData/saves`；若未来发生存档 schema 变更，必须先实现备份和迁移测试。
- 记录故障版本、触发条件、回滚时间、受影响渠道和后续修复版本。
