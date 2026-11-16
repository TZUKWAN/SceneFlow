# SECURITY — Poros Enterprise

## 权限模型（PRD §3.4）

有效权限 = 组织策略 ∩ 用户身份 ∩ 项目授权 ∩ Agent 预授权 ∩ 本次任务同意。任何交集为空 → 拒绝。
- 判定全部在服务端（`src/server/auth.ts`/`authz`）：组织边界取自会话 principal，请求体携带的组织/项目字段一律忽略。
- 角色：ADMIN > BUILDER > REVIEWER > EMPLOYEE（执行次序见 requireRole）。
- 项目资源过 `assertProjectAccess`（ADMIN 豁免）；跨组织读取返回空集或 404（不泄露存在性）。

## 不可信输入（PRD §3.4/SEC-01）

工具结果、网页、文档、反馈文本均为不可信数据：只做数据拼入，永不作为指令提升权限。验收：SEC-01 用例注入"忽略之前所有指令"文本，验证权限零变化。

## 模型通道准入（SEC-02）

- `MODEL_GATEWAY=mock`（默认）：契约测试输出，UI 与运行事件如实标注"未配置真实模型服务"。
- `MODEL_GATEWAY=deepseek`：必须有 `POROS_DEEPSEEK_API_KEY`，缺失即拒绝执行；**禁止静默降级到未授权公共免费网关**。
- `dsh-our-free-model` 仅可用于公开无敏感数据的开发测试，不进生产。

## Judgment 证据真实性（PRD §7.2/§1.2）

- 候选必须有显式来源；未批准不注入生产运行；注入逐条留痕 ruleId+version。
- 机械规则确定性评估；语义规则无 Judge 恒为 `UNCHECKED`——绝不记 PASS。
- 无自动晋级、无沉默接受、无总体成败到单条规则的伪归因；持久化失败返回真实错误（`ok:false`）。

## 凭证与密钥

- `.env`/`deploy/.env` 已入 `.gitignore`；CI 用仓库 Secrets。
- 密码 bcrypt(10) 哈希存 `user_credentials`；JWT 12h 过期，每次请求核对成员资格。
- S3 桶按 organizationId 前缀隔离对象键。
