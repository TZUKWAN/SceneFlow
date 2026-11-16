# BASELINE — 迁移前真实基线

> 基线 main SHA：18ec87ba62f58ee31be8ea864398896bedd3bd96
> 环境：Node v25.6.0 / npm 11.x / Windows 11 (win32 x64)
> 记录时间：2026-11-16（迁移分支建立前实测）

| 命令 | 结果 | 证据 |
|---|---|---|
| `npm ci` | ✅ 成功（773 包，44s） | `@earendil-works/pi-*` 在 npm 仍可安装（发行未下架，但项目方向已废弃——见 PRD §1.1） |
| `npm test`（含 pretest 面板/包构建） | ✅ **75 文件 / 656 用例通过，6 skipped** | vitest run 输出，exit 0 |
| `npm run build`（tsc） | ✅ 通过 | exit 0 |
| `npm run lint`（eslint） | ❌ **30 errors（全部迁移前已存在）** | `✖ 30 problems (30 errors, 0 warnings)` |

## 结论

迁移起点是**可构建、可测试**的绿色基线（lint 除外）。Phase E 清理后必须重新达到并超过该基线：test/build 不得退化，lint 30 错作为存量债在新代码中不得新增（新链自身零 error）。
