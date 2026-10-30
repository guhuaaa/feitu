# feitu · 废土末班车

基于本地规则与可选 AI 叙事的文字冒险原型，Windows 桌面端使用 Electron。没有模型密钥也可以离线游玩，玩家无需安装 Node.js 或开发工具。

当前开发版本为 **0.2.5**。本地打包、回归、60 分钟完整界面长测及跨版本存档验收已通过；正式发行仍待远端与平台验收、授权及签名等事项。具体证据与待办见 [PROJECT_STATE.md](PROJECT_STATE.md)。

## 开发与构建

开发环境需要 Node.js 22.12 或更高版本。使用唯一的桌面锁文件：

```powershell
cd desktop/electron
npm.cmd ci
npm.cmd run verify
npm.cmd start
npm.cmd run release:steam
npm.cmd run release:github
npm.cmd run release:github:verify
```

`release:github` 只在本地生成便携 ZIP，不会上传。完整命令、存档迁移及验收方法见 [桌面开发说明](desktop/electron/README.md)。修改版本使用 `npm.cmd run version:set -- <semver>`，同步桌面、锁文件、运行时及发行清单。

## 文件区分

- `packages/dsh-feitu-world/`：游戏运行时、内容与玩家界面。
- `desktop/electron/`：桌面壳、锁文件、测试与构建脚本。
- `tools/`、部分作者数据与契约：构建和内容校验输入。
- `release/manifests/`：发行文件清单；`release/staging/` 和 `release/artifacts/` 是本地生成产物，不进入源码提交。

原作全文、研究语料、模型密钥、玩家存档、日志、依赖目录和缓存不上传到本仓库。玩家数据保存在 `%APPDATA%\FeituWorld`，不写入安装目录。

源码上传清单为 `release/manifests/github-source-files.json`；`node tools/stage-github-source.mjs` 可生成独立源码快照与逐文件摘要，供上传前核查。公开 checkout 不含私有原作，测试会明确跳过原文逐行比对，仍执行存档迁移和其余运行时测试。

## 授权状态

本项目涉及小说改编，改编及商业发行授权、最终代码许可证尚未确认。源码上传不构成授权已落实或正式商业发行的声明。版权边界见 [版权说明](FEITU_LICENSE_AND_COPYRIGHT.md) 和 [权利核查事项](release/RIGHTS_AND_COMPLIANCE.md)。
