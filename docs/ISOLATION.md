# ISOLATION — 宿主 DSH 零影响证据（PRD §4）

> 本文件只随真实运行结果更新；每项标注执行方式与局限，不用"理论上隔离"充数。

## 硬边界（代码与部署层）

- `src/server/dsh-paths.ts`：一切路径只从 `POROS_HOME` 派生，缺失即抛错，**无操作系统默认目录回退**（隔离 by construction）。
- `deploy/docker-compose.yml`：独立 project/network/具名卷；DSH 服务零发布端口、非 root(10001)、`no-new-privileges`、`cap_drop: ALL`、`tmpfs /tmp`；**无任何宿主路径 bind mount、无 Docker socket、无特权、无 host 网络**。
- `deploy/Dockerfile.dsh`：node:24-bookworm-slim + 锁定版本 DSH；容器内专属 HOME/XDG/DSH_HOME。

## 验收状态矩阵

| 用例 | 状态 | 证据 | 执行方式与局限 |
|---|---|---|---|
| ISO-01 哨兵目录负向 | ✅ PASS | `node tests/isolation/iso-01-sentinel.mjs` | 仿真宿主 HOME（4 哨兵含金丝鹰令牌）→ 运行路径模块 → 哨兵哈希前后一致；源码静态守卫无默认目录回退。**软件级实现**：无 syscall 探针（Windows CI 条件限制），以"哈希清单+源码守卫+拒绝回退的构造"替代，如实标注。未触碰任何真实宿主 `.dsh` |
| ISO-02 卷/权限/网络静态审计 | ✅ PASS | `node tests/isolation/iso-02-compose-audit.mjs` | 解析 `docker compose config`：无特权/host 网络/docker.sock/root/发布端口/ bind 挂载；宿主路径黑名单未命中 |
| ISO-03 双实例互不影响 | ✅ PASS（脚本化） | `node tests/isolation/iso-03-dual-instance.mjs`（本机 + CI） | 独立 compose project（-p）各起 dsh 实例：A 写标记→B 读不到→A 自读一致→B 变更后 A 无泄漏；测试自清理（down -v） |
| ISO-04 进程与端口审计 | ✅ PASS（范围内） | Poros 全程仅经 docker 命令运行（从未执行宿主 dsh）；compose 零发布端口 | 宿主存在其他无关容器（lightrag/ycki/searxng）非本任务所起，不触碰不审计其内容；dshelp 类进程零新增 |
| ISO-05 权限负向（容器越宿主） | ✅ PASS（脚本化） | `node tests/isolation/iso-05-container-escape.mjs` | 专属 compose 项目内拉起容器尝试访问宿主路径/越权工具 → 拒绝+审计，测试自清理 |
| SEC-01 提示词注入/越权工具 | ✅ PASS（API 层） | tests/api/acceptance.test.ts SEC-01 用例 | 不可信内容不改变权限；DSH 事件流工具白名单审计见 src/server/dsh-runtime.ts auditToolCalls |

## 运行时硬化教训（2026-11-16 实机）

- compose `tmpfs: /tmp` 默认 **noexec** 会击穿 DSH 原生绑定加载器（其默认把 .node 物化到
  os.tmpdir() 再 require）。已设 `NARB_DISABLE_NATIVE_CACHE=1`（compose + exec 双侧）直接从
  镜像路径加载——tmpfs 硬化不放松。详见 docs/E2E_EVIDENCE.md。

## 真实运行证据（构建后回填）

- 镜像构建：`docker compose -f deploy/docker-compose.yml build` → Built（修复卷属主后重建）
- 容器内 DSH 版本：`docker run --rm poros/dsh:0.2.2-rc.1 dsh --version` → **0.2.2-rc.1**（唯一 Harness 在隔离容器内运行的直接证据）
- 镜像 digest 锁定：`sha256:be1aa0c688600f365e1e43f4173876a06172cce606f965a95e57aa8484191932`
- 容器内身份：uid=10001(poros) 非 root；HOME=/home/poros；DSH_HOME 容器内专属
