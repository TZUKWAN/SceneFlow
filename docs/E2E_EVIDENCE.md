# E2E_EVIDENCE — 真实执行闭环证据（审查项①要求的端到端证明）

> 更新原则：只随真实运行结果更新；每项给命令与真实输出。生成代码是文件不是字符串
> （本轮教训：内嵌 stub 字符串的手写括号 golf 产出过语法错误）。

## 环境事实

- 专属容器：`poros-dsh-1`（image `poros/dsh:0.2.2-rc.1`，uid=10001(poros)，tmpfs /tmp，零发布端口）
- 容器内身份与版本实测：`docker exec poros-dsh-1 sh -c 'dsh --version; id'`
  → `0.2.2-rc.1` / `uid=10001(poros) gid=10001(poros)`
- 宿主 DSH：全程零接触（无读取/无执行/无挂载；ISO-01 哨兵负向 PASS）

## 端到端命令与结果（2026-11-16）

```bash
POROS_E2E_REQUIRED=1 node tests/e2e/run-e2e.mjs
```

真实输出（节选）：

```text
[e2e] API 服务已启动（POROS_RUNTIME=dsh，真实 DSH 执行通道）
[e2e] ① NL 构建 Agent 成功 id=cmwja… nlSource 留痕=true
[e2e] ② AgentGrant bash 已记录（服务端强制装载 + 事件白名单审计）
[e2e] ③ 已发布 v1（不可变快照）
[e2e] ④ 员工任务完成 runtime=dsh status=SUCCEEDED
[e2e]    真实执行证据：dsh.session ✓ dsh.tool_call ✓ dsh.tool_result(含真实命令输出) ✓ 通道标注 dsh(stub) ✓
[e2e] ⑤ 员工纠错 → 候选规则 cmwjavlml0014gdcgtcqllizu（CANDIDATE，未批准不注入）
[e2e]    负向验证：候选未批准 → 未注入生产运行 ✓
[e2e] ⑥ 审阅者批准规则 cmwjavlml0014gdcgtcqllizu
[e2e] ⑦ 第二次真实 DSH 运行：规则已注入并逐条评估 → run.status=SUCCEEDED
```

事件流真实证据（RunEvent 落库，SSE `/api/tasks/:id/events` 可回放）：

- `dsh.session`：容器内真实 headless 会话（sessionId 落库）
- `dsh.tool_call`：`{"tool":"bash","input":{"command":"echo POROS-DSH-REAL-EXEC","description":"verify dsh exec"}}`
- `dsh.tool_result`：`{"status":"completed","result":"POROS-DSH-REAL-EXEC\n…"}`（含 DSH fs-sandbox 的 landlock 提示）
- `dsh.final`：会话最终文本

## 模型通道诚实标注

| 通道 | 含义 | 触发 |
|---|---|---|
| `dsh(stub)` | **真实 DSH 执行**（会话/工具循环/事件）+ 容器内测试桩模型（`scripts/dsh-model-stub.js`） | `POROS_DSH_MODEL_STUB=1`（开发/CI） |
| `dsh(container-env)` | 真实 DSH 执行 + 容器内真实网关密钥（compose 注入 `DEEPSEEK_API_KEY`） | 生产形态 |
| `mock` / `deepseek` | 模型网关契约通道（不经 DSH；开发无 Docker 时用，UI 如实标注） | `POROS_RUNTIME=gateway` |

禁止事项执行情况：未用 mock 输出冒充 DSH 执行（stub 通道在 run.modelGateway 字段如实标注
`dsh(stub)`）；未把 DB CRUD 冒充 Agent 构建（NL 草稿经网关生成 + 差异可见）；未把历史事件
回放冒充实时执行（事件由真实运行产生并落库）。

## 本轮实机抓到并修掉的问题（真实调试记录）

1. **compose `tmpfs: /tmp` 默认 noexec** × DSH 原生绑定加载器（把 .node 物化到 os.tmpdir()
   再 require）→ 任何 `--patch` 启动即崩（`No usable prebuilt binary`）。修复：
   `NARB_DISABLE_NATIVE_CACHE=1`（compose + exec 双侧），tmpfs 硬化不放松。
2. **POSIX 非 interactive shell 后台作业 stdin=/dev/null**：桩注入脚本里后台化的 `cat`
   读到空文件。修复：cat 前台消费 stdin，node 再后台化。
3. **内嵌 stub 字符串的手写括号 golf** 产出语法错误 → 桩改为真实文件资产
   `scripts/dsh-model-stub.js`（`node --check` 可验证）。
4. **NL 草稿名唯一约束冲突**（确定性生成器重复同名）→ NL 路径自动去重；显式路径撞名 409。
