# DEPLOYMENT — 从零跑起来（审查项⑤：文档与实际配置一致）

> 约束：全程不接触宿主 DSH（`~/.dsh`、宿主 `dsh` 命令）。Poros 的 DSH 只存在于
> `deploy/docker-compose.yml` 定义的专属容器内（隔离证据见 docs/ISOLATION.md）。

## 前置

- Node ≥ 20（开发实测 v22/v24/v25 可用）；Docker + Docker Compose v2
- 端口：55432（Postgres）、59000（SeaweedFS S3）、3000（Poros API/Web）——均只绑环回

## 最小步骤（fresh clone → 运行）

```bash
npm ci                        # postinstall 自动执行 prisma generate（缺失会 build 失败）
cp .env.example .env          # 必填：POROS_DB_PASSWORD / JWT_SECRET(≥16字符) / DATABASE_URL
npm run db:up                 # 起 db + s3 两个容器（注意：服务名是 s3，无 minio）
npx prisma migrate deploy     # 应用迁移（含质量状态枚举）
npm run build                 # tsc，零错误
npm start                     # tsx src/server/index.ts → http://127.0.0.1:3000
```

## 测试

```bash
npm test                      # = vitest run tests/api + test:isolation
# tests/api 需要活的 db：先 npm run db:up；测试自建 poros_test 库并自动迁移
# test:isolation 需要 POROS_DB_PASSWORD（compose 变量）+ Docker
```

## 配置项（.env）

| 变量 | 必须 | 说明 |
|---|---|---|
| `POROS_DB_PASSWORD` | ✅ | compose db 初始化密码（仅首次建卷生效） |
| `DATABASE_URL` | ✅ | `postgresql://poros:<密码>@127.0.0.1:55432/poros?schema=public` |
| `JWT_SECRET` | ✅ | ≥16 字符；**没有默认值，缺失/过短服务拒绝启动**（安全审查项④） |
| `S3_*` | 建议 | .env.example 有开发默认；生产必换 |
| `MODEL_GATEWAY` | 可选 | `mock`（默认，UI 标注未配置）\| `deepseek`（需 `POROS_DEEPSEEK_API_KEY`） |
| `POROS_DSH_MODEL_STUB` | 可选 | `1` = 开发/CI 用真实 DSH 执行 + 测试桩模型（生产禁用） |
| `POROS_DSH_CONTAINER` | 可选 | DSH 容器名（默认 `poros-dsh-1`） |

## DSH 专属容器

```bash
docker compose -f deploy/docker-compose.yml up -d dsh   # 专属网络/卷，零发布端口，非 root
docker compose -f deploy/docker-compose.yml exec dsh dsh --version
```

模型密钥只经环境注入容器（`DEEPSEEK_API_KEY` 或 profile patch 的 `apiKeyEnv` 指向的变量名），
绝不落库、绝不写进 profile 文件本体、绝不读取宿主 DSH 的任何登录态。

## 已知边界

- `npm run e2e` 需要本机 Docker 与 dsh 容器（tests/e2e/run-e2e.mjs）
- ISO-03 已脚本化（tests/isolation/iso-03-dual-instance.mjs）
