# CLEANUP_REPORT — Poros Enterprise V2

> 规则执行：先证明无引用/数据不损/替代实现与测试通过，再删除（执行提示词 §5）。删除后已重跑全量（见文末）。

## 删除清单（git rm，均可由 git 历史恢复）

| 路径 | 理由 | 替代实现 |
|---|---|---|
| `src/orchestrator/`（8 态机/BuildContext/闸门挂起） | 五闸门自构建流程整体废弃（PRD §1.3 删除类）；校验模式思想已由 zod 草稿配置承载 | Agent Builder 草稿-差异-发布（`src/server/routes/index.ts`） |
| `src/federation/` | 8 源 MCP/Skill 聚合检索 = PRD §0.4 明令不做的"通用聚合搜索" | 能力授权白名单（AgentGrant） |
| `src/gates/` | 五道闸门 TUI/Web 由审批流替代 | `/api/approvals` |
| `src/execution/` | pi-subagents/pi-agent-loop vendored 运行链；唯一 Harness 已切 DSH 容器 | `deploy/Dockerfile.dsh` + 运行服务 |
| `src/distill/` | 蒸馏四变换/意图签名属旧场景库产品 | 无（产品决策删除） |
| `src/scenario/` | 场景库命中/填槽删除；**ledger 纯逻辑以 Judgment V2 重实现**（§1.2 六条统计错误全部规避） | `src/server/judgment.ts` + `runner.ts` |
| `src/panel/`（launch.ts 1784 行等） | 旧 TUI 面板；15% holdout/自动晋级/silent-accepted 按 §1.2 禁用而非迁移 | Web 外壳（`src/server/public/`） |
| `src/memory/` | context-mode SQLite 记忆 | DSH 官方会话机制（后续）+ 组织知识绑定 |
| `src/core/` `src/domains/` `src/product/` `src/acceptance/` | 经 grep 确认依赖 pi-/earendil/context-mode，属旧运行链基础设施 | Prisma 数据模型（`prisma/schema.prisma`） |
| `src/kernel-entry.ts` | Pi 内核入口 | `src/server/index.ts` |
| `pi-package/` | Pi 扩展包入口 | DSH 官方插件机制（评估接入中） |
| `integrations/`（browser/terminal/vscode-context） | Pi TUI 上下文扩展 | 无（桌面操作默认不启用，PRD §0.4） |
| `scripts-kernel/launch/panel-build.mjs`、`scripts/` | 旧构建链与过程脚本（含 `SCEN_ID` 残留物） | tsc + vitest + compose 新链 |
| `tests/unit|integration|e2e|virtual-user`、`tests/setup.ts`、`tests/fixtures` | 全部被测对象已删除；虚拟用户驱动的思想由验收测试继承 | `tests/api/acceptance.test.ts` |
| `package.json` 中 `@earendil-works/pi-*`、`pi-mcp-adapter`、`pi-subagents`、`pi-reactor`、`context-mode`、`ws`、`@types/ws` 依赖 | 唯一 Harness = DSH | `@deepseek-ai/dsh`（容器内） |

## 未删除的遗留与理由

- `CHANGELOG.md`：项目历史记录，按"保留历史"原则迁移保留。
- `eslint.config.js` 中 `pi-package/dist` ignore：无害一行，后续清理。
- Git 提交历史完整保留。

## 删除后全量验证（全部真实执行）

| 命令 | 结果 |
|---|---|
| `npm test`（vitest 16 用例 + ISO-01/02/05） | ✅ 16/16 + 3×PASS |
| `npm run build`（tsc） | ✅ 0 错误（迁移前遗留的 2 处测试类型问题已修） |
| `npm run lint`（eslint） | ✅ 0 错误（迁移前 30 存量债随旧代码移除；新链零新增） |
| 容器内 `dsh --version` | ✅ 0.2.2-rc.1（唯一 Harness 在隔离容器内） |

## 旧数据边界

仓库代码删除 ≠ 用户磁盘数据。Poros 全程未读写任何本机 DSH 数据；若旧 pi-scenario 曾产生用户数据，需由用户自行备份（Poros 不提供、也不访问旧数据目录）。
