# REUSE_AUDIT — Poros Enterprise V2

> 规则（PRD §8）：没有复用调查，禁止新写功能。每行给出候选现成方案、版本、许可、复用方式、弃选理由与最小自研范围。
> 基线 main SHA：18ec87ba62f58ee31be8ea864398896bedd3bd96 · 分支：refactor/poros-dsh

## 最高层复用决策

| 功能 | 候选现成实现 | 版本/许可/链接 | 复用方式 | 放弃其他方案原因 | 新增代码范围 | 证据 |
|---|---|---|---|---|---|---|
| Agent Harness（唯一） | **DSH 官方发行**（@deepseek-ai/dsh） | 0.2.2-rc.1+ / MIT / github.com/deepseek-ai/deepseek-harness | 官方 npm 发行包装入 Poros 专属容器；只用官方插件/会话/工具扩展点 | Pi 运行链废弃（PRD §1.1）；不引入第二套 Harness；不修改宿主 DSH（P0） | DSH 适配器（会话生命周期、工具调用桥、结果回流） | npm registry 实测存在 0.2.2-rc.3；上游 MIT |
| 企业外壳 UI | React + shadcn/ui + Radix + Tailwind + TanStack Query + RHF+Zod | shadcn/ui（MIT）/ Radix（MIT）/ Tailwind（MIT）/ TanStack Query（MIT）/ RHF（MIT）/ Zod（MIT） | 成熟组件库直装 | PRD §3.2 明令"不准自造按钮/表格/对话渲染器/表单/文件浏览器" | 布局壳 + 业务页面接线 | PRD §3.2 指定 |
| 多 Bot 工作台参考 | DS-Bot | Apache-2.0 / github.com/Fei2411/DS-Bot（8k★） | 核查其 Bot/群聊/能力配置实现，可移植模块薄适配；**禁止整仓复制**（本机数据模型/权限/打包与企业服务端不同） | 自研多 Agent 工作台 = 重造轮子 | 组织维度适配层 | 许可证与仓库实测 |
| 身份/权限 | 自研 RBAC 映射在可信后端 + 成熟会话库 | Node 侧：iron-session/JWT（MIT）任选其一锁版本；PRD 允许"可复用 RBAC 库" | 组织-成员-角色-项目四级作用域在 Poros 后端强制；前端隐藏不算授权 | 不自研认证协议；不引入重量级 IdP 依赖 | 策略执行点（中间件 + 每个资源读写检查） | PRD §3.2/§3.4 |
| 数据库 | PostgreSQL + Prisma | PostgreSQL 17 / Prisma（Apache-2.0） | ORM 迁移与 Row-Level Security 纵深防御 | 不自研存储引擎（PRD §3.2） | Schema（组织/成员/项目/Agent/版本/授权/任务/运行/判断/文件元数据） | PRD §3.2 |
| 对象存储 | S3 兼容（MinIO 本地开发 / 云 S3 生产） | MinIO（AGPL v3，仅作服务部署非链接）/ AWS SDK v3（Apache-2.0） | SDK 直用，put/get/presign | 不自研文件服务 | 文件元数据 + 权限检查 | PRD §6.1 |
| Chat UI | 不自研完整聊天组件：复用 DSH Web UI 能力 + 上述 React 生态 | DSH web（MIT） | 优先 DSH 官方 Web 嵌入/扩展；不足处以 shadcn 组件补 | PRD 明令不自研聊天渲染器 | 消息/运行事件桥 | PRD §8.1 |
| 任务队列 | 数据库队列（pg-boss 或自研极薄轮询） | pg-boss（MIT） | 阶段一用成熟 DB 队列 | 不自研分布式调度（PRD §3.2） | 任务入队/认领/状态机 | PRD §3.2 |
| 可观测性 | pino（MIT）+ OpenTelemetry JS（Apache-2.0） | 锁版本 | 结构化日志 + runId trace | 不自研日志框架 | 日志/审计写入点 | PRD §3.2 |
| Skills/MCP | DSH 官方机制 + pi-mcp-adapter 的 MCP 调用思想 | DSH 官方协议 | 只通过有权限的工具/服务接口接入 | 不重造能力（PRD §2 P0-2） | 能力绑定与授权记录 | PRD §2 |
| Kdocs | kdocs-skill（skillhub） | 待核查 CLI/账号/配额/许可 | 授权后启用；**无凭证时 mock 适配器做契约测试并标注"未配置"** | 不登录个人账号跑企业任务 | 薄适配器 + 契约测试 | PRD §6.3 |
| IMA / TinyFish / Scrapling / Hy-Memory / Graphify / agent-desktop | 后置评估 | 见 PRD §6.3 边界 | 可选项，默认不进核心闭环；agent-desktop 默认不安装 | 初版不启用 | 接口预留 | PRD §6.1 表格 |
| Judgment Layer | **自研（PRD 指定的核心自研项）**；可迁移旧 ledger 纯逻辑 | 旧 src/scenario/ledger.ts（622 行）+ team-ledger.ts + selfcheck.ts | 提炼类型与机械检查；**禁用旧统计错误**（PRD §1.2 六条） | 现无满足"组织判断资产"语义的现成品 | 候选/审批/作用域/注入/验证/回滚全链 | PRD §7 |

## 版本锁定（Phase 1 完成时填实）

- DSH：待容器内实测后锁定确切版本与镜像 digest（候选 0.2.2-rc.1，npm latest 标签）。
- 全部第三方：入 `package.json` 锁版本 + `docs/THIRD_PARTY.md` + SBOM（PRD §6.3）。

## 明确不引入

Pi 运行链、OpenBot/Codex/OpenCode/Harness² 运行时、dsh-purge、第二套 Harness、`dsh-our-free-model` 生产通道、agent-desktop 默认环境。
