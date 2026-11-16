# THIRD_PARTY — 第三方组件清单（SBOM 入口）

| 组件 | 版本 | 许可证 | 用途 | 备注 |
|---|---|---|---|---|
| @deepseek-ai/dsh | 0.2.2-rc.1 | MIT | 唯一 Agent Harness（容器内） | 上游 github.com/deepseek-ai/deepseek-harness |
| node | 24-bookworm-slim 基础镜像 | MIT 等 | 运行时镜像基座 | Node ≥24.9.0 |
| postgres | 17-alpine | PostgreSQL License | 主数据库 | 官方镜像 |
| chrislusf/seaweedfs | 3.85 | Apache-2.0 | S3 兼容对象存储 | 替代 MinIO（本环境镜像源不可达，已实测记录） |
| Fastify / @fastify/static | 5.x / 8.x | MIT | API 框架 | |
| Prisma / @prisma/client | 6.19.0 | Apache-2.0 | ORM + 迁移 | |
| zod | 4.6.7 | MIT | 输入校验 | 仓库既有 |
| jsonwebtoken / bcryptjs | 9.x / 3.x | MIT | 会话/口令 | |
| @aws-sdk/client-s3 | 3.x | Apache-2.0 | S3 客户端 | |
| pino | 9.5.0 | MIT | 结构化日志 | fastify 内建 |
| vitest / esbuild / tsx / typescript-eslint / prettier / eslint | 仓库既有 | MIT 等 | 工具链 | |

## 评估后未引入（记录于 REUSE_AUDIT）

DS-Bot（Apache-2.0，作多 Bot 工作台设计参考而非整仓复制）、Kdocs/IMA/TinyFish（无凭证，mock 契约测试并标注"未配置"）、agent-desktop（默认不启用）、dsh-purge（不接入）。

## 许可证状态警示

原仓库无根 LICENSE 文件（迁移前事实，PRD §1.1）。在权利人明确许可证前：本仓库代码按"仅审查不外发"管理；第三方组件以上表许可证为准。
