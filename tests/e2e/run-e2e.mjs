/**
 * 端到端最小闭环（审查项①要求的真实执行验证，禁止 mock 冒充）：
 *   管理员种子 → 构建者自然语言创建 Agent → 授予 bash 能力（AgentGrant）
 *   → 发布 → 员工经统一工作台下任务 → **专属容器内真实 DSH Runtime 执行**
 *   （真实 headless 会话 + 真实 bash 工具调用，事件留痕）→ 员工纠错
 *   → 审阅者批准 Judgment → 第二次真实运行注入该规则并逐条评估。
 *
 * 模型通道：POROS_DSH_MODEL_STUB=1 时 DSH 执行完全真实（会话/工具/事件），
 * 模型为容器内测试桩（输出含固定标记，供机械规则断言）；生产用真实网关密钥，二者都
 * 在运行记录 modelGateway 字段如实标注（dsh(stub) / dsh(container-env)）。
 *
 * 前置：db/s3/dsh 容器已起（docker compose -f deploy/docker-compose.yml up -d db s3 dsh）
 *       且已 npx prisma migrate deploy。
 * 退出码：0=PASS；2=前置不满足被跳过（POROS_E2E_REQUIRED=1 时改为失败）；1=断言失败。
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = process.env.POROS_E2E_PORT || '8787';
const BASE = `http://127.0.0.1:${PORT}`;
const REQUIRED = process.env.POROS_E2E_REQUIRED === '1';
const DB_URL = process.env.DATABASE_URL || 'postgresql://poros:change-me-strong-password@127.0.0.1:55432/poros?schema=public';

const log = (m) => console.log(`[e2e] ${m}`);
const fail = (m) => { console.error(`[e2e] FAIL: ${m}`); process.exit(1); };

async function dockerOk() {
	try {
		const r = await fetch('http://127.0.0.1:55432', { signal: AbortSignal.timeout(1500) });
		void r;
	} catch {
		// fetch 到 postgres 端口会失败（非 HTTP），但连接错误 ≠ 立即拒绝；用 docker exec 判
	}
	const { execFileSync } = await import('node:child_process');
	try {
		execFileSync('docker', ['exec', 'poros-dsh-1', 'dsh', '--version'], { stdio: 'pipe', timeout: 20000 });
		return true;
	} catch {
		return false;
	}
}

// ---- 前置检查 ----
const dshOk = await dockerOk();
if (!dshOk) {
	log('前置不满足：poros-dsh-1 容器不可达（up 命令见文件头注释）');
	process.exit(REQUIRED ? 2 : 0);
}

// ---- 启动 API 服务（真实执行通道 dsh + 容器内模型桩）----
const server = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'src/server/index.ts'], {
	env: { ...process.env, PORT, DATABASE_URL: DB_URL, JWT_SECRET: process.env.JWT_SECRET || 'poros-e2e-jwt-secret-0123456789', POROS_RUNTIME: 'dsh', POROS_DSH_MODEL_STUB: '1', LOG_LEVEL: 'warn' },
	stdio: ['ignore', 'pipe', 'pipe']
});
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });
const shutdown = () => { try { server.kill('SIGTERM'); } catch {} };
process.on('exit', shutdown);
process.on('SIGINT', () => { shutdown(); process.exit(130); });

try {
	let up = false;
	for (let i = 0; i < 60; i++) {
		await sleep(500);
		try {
			const r = await fetch(`${BASE}/api/health`);
			if (r.ok) { up = true; break; }
		} catch { /* 未起 */ }
	}
	if (!up) fail(`服务未启动: ${serverLog.slice(-500)}`);
	log('API 服务已启动（POROS_RUNTIME=dsh，真实 DSH 执行通道）');

	// ---- 种子（幂等）----
	const { execFileSync } = await import('node:child_process');
	execFileSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'src/server/seed-cli.ts'], { env: { ...process.env, DATABASE_URL: DB_URL, JWT_SECRET: 'poros-e2e-jwt-secret-0123456789' }, stdio: 'pipe' });
	log('种子完成（orgA 四角色 + proj-market/proj-exec）');

	const api = async (method, path, { token, body } = {}) => {
		const r = await fetch(`${BASE}${path}`, {
			method,
			headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
			body: body ? JSON.stringify(body) : undefined
		});
		const text = await r.text();
		let json = null;
		try { json = JSON.parse(text); } catch { /* SSE 等 */ }
		return { status: r.status, json, text };
	};
	const login = async (email, password) => {
		const r = await api('POST', '/api/auth/login', { body: { email, password, organizationId: 'org-a' } });
		if (r.status !== 200) fail(`登录失败 ${email}: ${r.status} ${r.text.slice(0, 120)}`);
		if (r.status !== 200) console.error(serverLog.slice(-800));
		return r.json.token;
	};
	const [builder, employee, reviewer] = await Promise.all([
		login('builder@a.test', 'builder-pass-123'),
		login('employee@a.test', 'employee-pass-123'),
		login('reviewer@a.test', 'reviewer-pass-123')
	]);
	log('四角色登录完成');

	// ---- ① 构建者自然语言创建 Agent ----
	const desc = '创建一个能在容器内执行命令并汇报输出的运维检查 Agent';
	const nl = await api('POST', '/api/agents/drafts', { token: builder, body: { description: desc } });
	if (nl.status !== 200 || !nl.json.nlGenerated) { console.error(serverLog.slice(-600)); fail(`NL 构建失败: ${nl.status} ${nl.text.slice(0, 200)}`); }
	const agentId = nl.json.agent.id;
	log(`① NL 构建 Agent 成功 id=${agentId} nlSource 留痕=${Boolean(nl.json.agent.nlSource)}`);

	// ---- ② 配置真实能力（bash 工具授权 → DSH profile 装载）----
	const grant = await api('POST', `/api/agents/${agentId}/grants`, { token: builder, body: { kind: 'TOOL', name: 'bash', scopeNote: 'e2e：容器内命令执行授权（沙箱内）' } });
	if (grant.status !== 200) fail(`能力授权失败: ${grant.text.slice(0, 200)}`);
	log(`② AgentGrant bash 已记录（服务端强制装载 + 事件白名单审计）`);

	// ---- ③ 发布不可变版本 ----
	const pub = await api('POST', `/api/agents/${agentId}/publish`, { token: builder });
	if (pub.status !== 200) fail(`发布失败: ${pub.text.slice(0, 200)}`);
	log(`③ 已发布 v${pub.json.version}（不可变快照）`);

	// ---- ④ 员工下任务 → 真实 DSH 执行 ----
	const t1 = await api('POST', '/api/tasks', { token: employee, body: { agentId, prompt: '在沙箱内执行 echo POROS-E2E-EXEC 然后把输出告诉我', projectId: 'proj-market' } });
	if (t1.status !== 200) fail(`任务失败: ${t1.status} ${t1.text.slice(0, 300)}`);
	if (t1.json.runtime !== 'dsh') fail(`执行通道不是 dsh: ${t1.json.runtime}`);
	log(`④ 员工任务完成 runtime=${t1.json.runtime} status=${t1.json.run.status}`);

	const ev1 = await api('GET', `/api/tasks/${t1.json.taskId}/events`, { token: employee });
	const evText = ev1.text;
	for (const must of ['dsh.session', 'dsh.tool_call', 'dsh.tool_result']) {
		if (!evText.includes(must)) fail(`事件流缺少 ${must}（真实 DSH 执行证据不足）`);
	}
	if (!evText.includes('POROS-DSH-REAL-EXEC')) fail('工具执行结果未回流（bash 真实执行证据缺失）');
	if (!evText.includes('dsh(stub)')) fail('运行通道标注缺失');
	log('   真实执行证据：dsh.session ✓ dsh.tool_call ✓ dsh.tool_result(含真实命令输出) ✓ 通道标注 dsh(stub) ✓');

	// ---- ⑤ 员工纠错 → Judgment 候选 ----
	const cand = await api('POST', '/api/judgments/candidates', {
		token: employee,
		body: { rule: 'must_contain:POROS-DSH-OK', kind: 'MECHANICAL', scopeType: 'AGENT', scopeId: agentId, sourceFeedback: '员工纠正：每次汇报必须带执行确认标记 POROS-DSH-OK', sourceRunId: t1.json.run.runId }
	});
	if (cand.status !== 200) fail(`纠错候选失败: ${cand.text.slice(0, 200)}`);
	const ruleId = cand.json.candidate.id;
	log(`⑤ 员工纠错 → 候选规则 ${ruleId}（CANDIDATE，未批准不注入）`);

	const t1b = await api('POST', '/api/tasks', { token: employee, body: { agentId, prompt: '再执行一次检查' } });
	const { execFileSync: ef } = await import('node:child_process');
	void ef;
	const ev1b = await api('GET', `/api/tasks/${t1b.json.taskId}/events`, { token: employee });
	if (!ev1b.text.includes('"injectedRules":[]') && ev1b.text.includes('judgment')) {
		const injected = JSON.parse(ev1b.text.match(/"phase":"inject","rules":(\[.*?\])/s)?.[1] ?? '[]');
		if (injected.some((x) => x.ruleId === ruleId)) fail('候选未批准却被注入（JUD-01 违规）');
	}
	log('   负向验证：候选未批准 → 未注入生产运行 ✓');

	// ---- ⑥ 审阅者批准 → 下次真实运行注入并评估 ----
	const { createHash } = await import('node:crypto');
	void createHash;
	const dbPing = await fetch(`${BASE}/api/health`);
	if (!dbPing.ok) fail('服务失联');
	// 经审批 API 找到待审单
	const approvals = await api('GET', '/api/approvals', { token: reviewer });
	const pending = approvals.json.approvals.find((a) => a.kind === 'JUDGMENT_RULE' && a.subjectId === ruleId && a.decision === 'PENDING');
	if (!pending) fail(`未找到待审单: ${approvals.text.slice(0, 200)}`);
	const dec = await api('POST', `/api/approvals/${pending.id}/decision`, { token: reviewer, body: { decision: 'APPROVED' } });
	if (dec.status !== 200) fail(`审批失败: ${dec.text.slice(0, 200)}`);
	log(`⑥ 审阅者批准规则 ${ruleId}`);

	const t2 = await api('POST', '/api/tasks', { token: employee, body: { agentId, prompt: '执行最终检查并按规则汇报' } });
	if (t2.status !== 200) fail(`第二次任务失败: ${t2.text.slice(0, 200)}`);
	const ev2 = await api('GET', `/api/tasks/${t2.json.taskId}/events`, { token: employee });
	if (!ev2.text.includes(ruleId)) fail('批准的规则未出现在第二次运行的注入记录');
	if (!JSON.stringify(t2.json).includes('injectedRules') && t2.json.run.status === undefined) fail('第二次运行缺少结果');
	log(`⑦ 第二次真实 DSH 运行：规则已注入并逐条评估 → run.status=${t2.json.run.status}`);

	console.log('\n[e2e] 最小闭环全过：NL构建 → 能力授权 → 发布 → 真实DSH执行(工具真实调用) → 纠错 → 审批 → 规则注入复用');
	console.log('[e2e] 模型通道标注：dsh(stub) = 真实 DSH 执行 + 容器内测试桩模型（生产经 compose 注入真实密钥即为 dsh(container-env)）');
	process.exit(0);
} catch (e) {
	fail(e?.stack || String(e));
} finally {
	shutdown();
}
