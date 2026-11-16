# MIGRATION_INVENTORY — Poros Enterprise V2

> 逐目录 KEEP / MIGRATE / DELETE / UNCERTAIN。基线 main SHA：18ec87ba62f58ee31be8ea864398896bedd3bd96。
> 规则：旧代码不得因"看着没用"盲删——先证明无引用、数据不损失、替代实现与测试通过（执行提示词 §5）。

## 顶层

| 路径 | 判定 | 理由 |
|---|---|---|
| `src/orchestrator/` | MIGRATE→DELETE | 8 态状态机 + BuildContext(zod) 的**校验模式**可提炼；Pi event-bus 依赖不可留。闸门挂起/恢复由新 Agent Builder 的草稿/发布机制替代 |
| `src/federation/` | DELETE | 8 源联邦（mcp.so/ModelScope/Cline 等聚合检索）属"通用 MCP 聚合搜索"，PRD §0.4 明确不做 |
| `src/gates/` | DELETE | 五道闸门 TUI/Web 流程由 Builder 草稿-差异-审批替代（PRD §5）；GateDecision 类型思想并入审批流 |
| `src/execution/` | MIGRATE→DELETE | 能力安装器/权限 hook 思想并入"策略与能力网关"；pi-subagents/pi-agent-loop vendored 代码全部移除 |
| `src/acceptance/` | UNCERTAIN | 任务级规则 judge + 报告归因思想可服务 Judgment 验证层；组件级探活与联邦耦合部分删除。待 Phase 3 定 |
| `src/distill/` | DELETE | 蒸馏四变换 + 意图签名是旧"场景库"产品逻辑，新定位无对应物 |
| `src/scenario/` | MIGRATE | **ledger.ts(622 行)/team-ledger.ts/selfcheck.ts 是 Judgment 原型**（PRD §1.1 指明可迁移）；场景库命中/填槽部分删除；§1.2 六条统计错误必须禁用 |
| `src/panel/` | MIGRATE→DELETE | launch.ts(1784 行) 的自检/ledger 调用提取纯逻辑；15% holdout 逻辑删除；面板本体由新 Web 工作台替代 |
| `src/memory/` | DELETE | context-mode(SQLite+BM25) 会话记忆由 DSH 官方会话机制 + 组织知识绑定替代 |
| `src/core/` `src/domains/` `src/product/` | UNCERTAIN | Phase 0 逐文件审计后定（可能是公共类型/领域模型，可提炼为组织业务模型的一部分） |
| `src/distill` 之外未列文件 | UNCERTAIN | 以 `madge` 依赖图 + 调用者搜索逐项判定 |
| `pi-package/` | DELETE | Pi 扩展入口（extension.ts）；DSH 官方插件机制替代 |
| `integrations/`（browser/terminal/vscode-context） | UNCERTAIN | 若仅 Pi TUI 上下文则 DELETE；作为 DSH 工具能力评估后定 |
| `scripts-kernel/launch/panel-build.mjs` | DELETE（替代后） | 新构建链（企业外壳 + 容器）取代；删除前验证新链可构建可启动 |
| `tests/`（78 个） | MIGRATE | 虚拟用户驱动/夹具可服务 E2E；五闸门/联邦相关用例随代码删除 |
| `docs/` `README.md` `ARCHITECTURE.md` `CHANGELOG.md` | MIGRATE | 重写为 Poros Enterprise 文档族（DEPLOYMENT/SECURITY/MIGRATION/THIRD_PARTY/CLEANUP_REPORT） |
| `package.json`（pi-scenario） | MIGRATE | 改名 @poros/enterprise 体系；删除全部 @earendil-works/pi-*、pi-mcp-adapter、pi-subagents、context-mode、pi-reactor 依赖 |

## 数据边界

- Git 历史保留；仓库代码删除 ≠ 用户磁盘数据（执行提示词 §5）。
- 旧产品若产生过用户数据：提供只读备份/显式导入工具；迁移脚本不访问任何本机 DSH。

## 待办（Phase 0→1 之间）

1. `madge` 生成 src 依赖图，逐文件确认无调用者后才进 DELETE 清单。
2. npm 基线 test/build/lint 真实结果记入 `docs/BASELINE.md`（随跑随填）。
