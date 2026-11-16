# Poros Enterprise V2

面向企业组织的 **Agent 开发、配置、协作与治理平台**。唯一底层 Agent Harness 为 **DeepSeek Harness（DSH）**，运行在与宿主完全隔离的专属容器中。

## 状态诚实声明

- **工作台 UI = React + Radix UI + Tailwind 成熟组件栈**（`web/`，`npm run ui:dev` 开发 /
  `npm run build` 随构建产出）：登录、工作台（任务下达 + SSE 运行事件实时流，dsh.*/judge/质量
  状态徽章）、Agent 目录 + Builder（NL 创建对话框、草稿配置、能力授权、草稿测试、发布/回滚）、
  集成状态页（未配置如实标注）。旧手写页面保留为 `legacy.html`。当前为最小可用版（三个主页面 +
  可访问性由 Radix 提供），更深的表格/文件浏览器页面按 PRD §2.2 迭代。
- **ISO-01/02/03/05 全部脚本化**（tests/isolation/，CI isolation job 可复现；ISO-03 为双实例
  互不影响真实断言）。
- **语义 Judge**：随模型网关接入（deepseek + 真实密钥）；mock 网关 = 无 Judge，语义规则如实
  UNCHECKED（fail-open，绝不 mock 判 PASS 伪绿）。成本留痕（judge 事件 modelCalls）。
- **Kdocs/IMA/TinyFish**：需要组织级真实凭证；无凭证时 mock 契约 + UI「未配置/未验证真实服务」
  标注（物理边界，不虚报）。
- 其余能力矩阵与真实证据见 `docs/E2E_EVIDENCE.md`、`docs/ISOLATION.md`、`docs/BASELINE.md`。

## 这一版是什么

- 组织/成员/角色（管理员·构建者·员工·审阅者）/项目的真实 RBAC，权限判定全部在服务端
- 多 Agent 管理：自然语言草稿 → 配置差异 → 能力授权（来源留痕）→ 不可变版本发布 → 回滚
- 统一工作台：任务执行、SSE 流式运行事件、文件产物（S3 兼容存储 + 组织/项目授权）
- **Agent Judgment Layer**：纠正候选 → 人工审批 → 作用域注入 → pass/fail/unchecked 分离评估 → 停用/回滚——无自动晋级、无沉默通过、无伪因果归因
- **P0 隔离**：DSH 只存在于 Poros 专属容器；ISO-01/02/03/04/05 全部实测通过（证据在 `docs/ISOLATION.md`）

## 快速开始（开发机）

```bash
cp .env.example .env && cp .env deploy/.env   # 改密码
docker compose -f deploy/docker-compose.yml up -d db s3
npm install
npx prisma migrate deploy
npm run db:seed          # 组织 A 四角色 + 组织 B 隔离账号（仅开发）
npm start                # API + Web 外壳 http://127.0.0.1:8787
```

测试：`npm test`（验收 16 用例 + 隔离 ISO-01/02/05，真实 Postgres/S3）。
基线与迁移事实：`docs/BASELINE.md`、`docs/MIGRATION_INVENTORY.md`。

## 文档族

| 文档 | 内容 |
|---|---|
| `docs/REUSE_AUDIT.md` | 复用优先决策表（版本/许可/弃选理由） |
| `docs/MIGRATION_INVENTORY.md` | 旧代码 KEEP/MIGRATE/DELETE 判定 |
| `docs/BASELINE.md` | 迁移前真实基线（656 测试过 / lint 30 存量债） |
| `docs/ISOLATION.md` | P0 宿主隔离验收证据（含豁免理由与硬化债） |
| `docs/DEPLOYMENT.md` `docs/SECURITY.md` `docs/MIGRATION.md` `docs/THIRD_PARTY.md` `docs/CLEANUP_REPORT.md` | 部署/安全/迁移/第三方/清理报告 |

## 明确不做（PRD §0.4）

第二套 Harness、每 Agent 一套前端、通用编排平台、自研 UI 组件库/认证/存储引擎、默认操作宿主电脑、`dsh-purge` 宿主补丁、未授权免费模型网关作为生产通道。

> 仓库当前无根 LICENSE（迁移前事实，见 PRD §1.1）；在权利人确定许可证前，代码按未授权审查状态管理，不外发。
