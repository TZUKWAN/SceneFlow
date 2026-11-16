# ARCHITECTURE — Poros Enterprise V2

## 逻辑边界

```
Web 工作台(最小静态壳) ──► Fastify API ──► 组织身份/RBAC（服务端强制）
                              │                │
                    Agent Builder/版本       Judgment Layer
                    任务运行器(mock/真实网关)   规则/注入/评估留痕
                              │                │
                    运行事件(SSE) / 审计日志    pass/fail/unchecked
                              │
              ┌───────────────┼───────────────┐
        PostgreSQL 17   SeaweedFS(S3)   DSH 专属容器(唯一 Harness)
```

## 模块

- `src/server/`：API 全量（认证/RBAC/Builder/任务/审批/Judgment/文件/集成状态）+ Web 外壳 + 种子。
- `src/server/judgment.ts`：作用域规则筛选 + 机械/语义评估（语义无 Judge 恒 UNCHECKED）。
- `src/server/runner.ts`：注入留痕 → 网关生成 → 逐条评估 → 事件流。
- `src/server/dsh-paths.ts`：隔离 by construction（POROS_HOME 唯一来源，缺失即拒）。
- `tests/api/acceptance.test.ts`：验收矩阵（真实 DB+S3）。
- `tests/isolation/`：ISO-01/02/05（哨兵/静态审计/容器逃逸负向）；ISO-03/04 实测记录于 docs/ISOLATION.md。
- `deploy/`：Dockerfile.dsh + compose（db/s3/dsh，隔离边界见 DEPLOYMENT.md）。
- `prisma/`：全量数据模型。

## 与旧版（pi-scenario）的根本差异

旧：一句话 → 五闸门人工决策 → 场景库固化，Pi 生态运行链。
新：企业组织内受治理的 Agent 资产——草稿/版本/授权/审批/Judgment 闭环；唯一 Harness 为容器化 DSH；宿主 DSH 零接触。
