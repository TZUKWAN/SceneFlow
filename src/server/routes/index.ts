/**
 * 业务路由（PRD §5.2 最小接口 + §7.3 Judgment 流程 + 文件服务）。
 * 每个处理器的第一件事：从 principal 取 organizationId（绝不信任请求体里的组织/项目字段）。
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getDb } from '../db.js';
import { requirePrincipal, requireRole, requireRoleExact, assertProjectAccess, signSession, verifyPassword, signDownloadTicket, verifyDownloadTicket } from '../auth.js';
import { runTask } from '../runner.js';
import { createGateway } from '../model-gateway.js';
import { putObject, getObject, storageKeyFor } from '../storage.js';
import { env } from '../env.js';

const idParam = z.object({ id: z.string().min(1) });

export async function registerRoutes(app: FastifyInstance): Promise<void> {
	const db = getDb();

	// ---- 认证 ----
	app.post('/api/auth/login', async (req, reply) => {
		const body = z.object({ email: z.string().email(), password: z.string().min(1), organizationId: z.string().min(1) }).parse(req.body);
		const member = await db.membership.findUnique({ where: { organizationId_userId: { organizationId: body.organizationId, userId: body.email } } });
		if (!member) return reply.code(401).send({ ok: false, error: '认证失败' });
		const cred = await db.$queryRawUnsafe<Array<{ password_hash: string }>>('SELECT password_hash FROM user_credentials WHERE email = $1', body.email).catch(() => []);
		if (!cred.length || !cred[0] || !verifyPassword(body.password, cred[0].password_hash)) return reply.code(401).send({ ok: false, error: '认证失败' });
		return { ok: true, token: signSession({ userId: body.email, organizationId: body.organizationId, role: member.role, email: body.email }) };
	});

	// ---- Agent Builder ----
	app.post('/api/agents/drafts', async (req, reply) => {
		const p = requirePrincipal(req, reply); if (!p) return;
		if (!requireRole(['BUILDER'], p, reply)) return;
		const body = z.object({ description: z.string().min(4).max(2000).optional(), name: z.string().min(1).max(120).optional(), department: z.string().default(''), config: z.record(z.string(), z.unknown()).optional() }).parse(req.body);
		let name: string;
		let description: string;
		let config: Record<string, unknown>;
		if (body.name) {
			// 显式表单创建（兼容路径）
			name = body.name;
			description = body.description ?? '';
			config = { ...(body.config ?? {}) };
		} else {
			// 审查项②：自然语言构建——LLM 生成结构化草稿，zod 校验，能力一律先空（授权表管理）
			if (!body.description) return reply.code(400).send({ ok: false, error: '需要 description（自然语言描述）或 name（显式创建）' });
			const gw = createGateway();
			const draft = await gw.draftAgent(body.description);
			name = draft.name;
			description = draft.description;
			config = { ...draft.config } as Record<string, unknown>;
		}
		// NL 生成路径：同名自动去重（确定性生成器可能重复产出同名草稿）；显式路径撞名 → 409
		if (!body.name) {
			const base = name;
			for (let suffix = 2; await db.agentDefinition.findFirst({ where: { organizationId: p.organizationId, name } }); suffix++) {
				name = `${base}-${suffix}`;
			}
		} else if (await db.agentDefinition.findFirst({ where: { organizationId: p.organizationId, name } })) {
			return reply.code(409).send({ ok: false, error: '同名 Agent 已存在' });
		}
		const agent = await db.agentDefinition.create({ data: { organizationId: p.organizationId, name, description, department: body.department, draftConfig: config as never, createdBy: p.userId, nlSource: body.name ? null : (body.description ?? '') } });
		return { ok: true, agent, diff: { before: null, after: config }, nlGenerated: !body.name };
	});

	app.patch('/api/agents/:id/draft', async (req, reply) => {
		const p = requirePrincipal(req, reply); if (!p) return;
		if (!requireRole(['BUILDER'], p, reply)) return;
		const { id } = idParam.parse(req.params);
		const body = z.object({ name: z.string().min(1).max(120).optional(), description: z.string().optional(), department: z.string().optional(), config: z.record(z.string(), z.unknown()).optional() }).parse(req.body);
		const existing = await db.agentDefinition.findFirst({ where: { id, organizationId: p.organizationId } });
		if (!existing) return reply.code(404).send({ ok: false, error: 'Agent 不存在或不属于本组织' });
		const before = existing.draftConfig;
		const agent = await db.agentDefinition.update({ where: { id }, data: { ...(body.name ? { name: body.name } : {}), ...(body.description !== undefined ? { description: body.description } : {}), ...(body.department !== undefined ? { department: body.department } : {}), ...(body.config ? { draftConfig: { ...(before as object), ...(body.config as object) } as never as never } : {}) } });
		return { ok: true, agent, diff: { before, after: agent.draftConfig } };
	});

	app.post('/api/agents/:id/grants', async (req, reply) => {
		const p = requirePrincipal(req, reply); if (!p) return;
		if (!requireRole(['BUILDER'], p, reply)) return;
		const { id } = idParam.parse(req.params);
		const body = z.object({ kind: z.enum(['TOOL', 'SKILL', 'MCP', 'KNOWLEDGE', 'MODEL']), name: z.string().min(1), scopeNote: z.string().default('') }).parse(req.body);
		const agent = await db.agentDefinition.findFirst({ where: { id, organizationId: p.organizationId } });
		if (!agent) return reply.code(404).send({ ok: false, error: 'Agent 不存在或不属于本组织' });
		const grant = await db.agentGrant.upsert({ where: { agentId_kind_name: { agentId: id, kind: body.kind, name: body.name } }, create: { agentId: id, kind: body.kind, name: body.name, scopeNote: body.scopeNote }, update: { scopeNote: body.scopeNote } });
		return { ok: true, grant };
	});

	app.post('/api/agents/:id/test-runs', async (req, reply) => {
		const p = requirePrincipal(req, reply); if (!p) return;
		if (!requireRole(['BUILDER'], p, reply)) return;
		const { id } = idParam.parse(req.params);
		const body = z.object({ prompt: z.string().min(1).max(20_000) }).parse(req.body);
		const agent = await db.agentDefinition.findFirst({ where: { id, organizationId: p.organizationId } });
		if (!agent) return reply.code(404).send({ ok: false, error: 'Agent 不存在或不属于本组织' });
		// 审查项②：真实草稿测试——以草稿人设+草稿授权执行，不产生版本、不入正式任务流（标题标记）
		const grants = await db.agentGrant.findMany({ where: { agentId: id } });
		const task = await db.task.create({ data: { organizationId: p.organizationId, projectId: null, agentVersionId: null, title: `【草稿测试】${agent.name}`, prompt: body.prompt, createdBy: p.userId } });
		const result = await runTask({ db, runtime: env.porosRuntime(), dshGrants: grants.map((g) => ({ kind: g.kind, name: g.name })), draftMode: { agentId: agent.id, agentName: agent.name, department: agent.department || '' } }, task.id);
		return { ok: true, taskId: task.id, run: result, runtime: env.porosRuntime() };
	});

	app.post('/api/agents/:id/publish', async (req, reply) => {
		const p = requirePrincipal(req, reply); if (!p) return;
		if (!requireRole(['BUILDER', 'ADMIN'], p, reply)) return;
		const { id } = idParam.parse(req.params);
		const agent = await db.agentDefinition.findFirst({ where: { id, organizationId: p.organizationId } });
		if (!agent) return reply.code(404).send({ ok: false, error: 'Agent 不存在或不属于本组织' });
		const version = agent.currentVersion + 1;
		const snapshot = await db.agentVersion.create({ data: { agentId: id, version, config: agent.draftConfig as never, publishedBy: p.userId } });
		await db.agentDefinition.update({ where: { id }, data: { currentVersion: version, status: 'PUBLISHED' } });
		await db.approvalRequest.create({ data: { organizationId: p.organizationId, kind: 'AGENT_PUBLISH', subjectId: id, requestedBy: p.userId, decision: 'APPROVED', decidedBy: p.userId, decidedAt: new Date() } });
		return { ok: true, version: snapshot.version, immutable: true };
	});

	app.post('/api/agents/:id/rollback', async (req, reply) => {
		const p = requirePrincipal(req, reply); if (!p) return;
		if (!requireRole(['BUILDER', 'ADMIN'], p, reply)) return;
		const { id } = idParam.parse(req.params);
		const body = z.object({ version: z.number().int().min(1) }).parse(req.body);
		const agent = await db.agentDefinition.findFirst({ where: { id, organizationId: p.organizationId } });
		if (!agent) return reply.code(404).send({ ok: false, error: 'Agent 不存在或不属于本组织' });
		const target = await db.agentVersion.findUnique({ where: { agentId_version: { agentId: id, version: body.version } } });
		if (!target) return reply.code(404).send({ ok: false, error: '目标版本不存在（版本不可变，回滚=改引用指针）' });
		await db.agentDefinition.update({ where: { id }, data: { draftConfig: target.config as never, currentVersion: target.version, status: 'PUBLISHED' } });
		return { ok: true, currentVersion: target.version };
	});

	app.get('/api/agents', async (req, reply) => {
		const p = requirePrincipal(req, reply); if (!p) return;
		const agents = await db.agentDefinition.findMany({ where: { organizationId: p.organizationId }, include: { versions: { orderBy: { version: 'desc' }, take: 1 }, grants: true } });
		return { ok: true, agents };
	});

	// ---- 任务与运行 ----
	app.post('/api/tasks', async (req, reply) => {
		const p = requirePrincipal(req, reply); if (!p) return;
		const body = z.object({ projectId: z.string().optional(), agentId: z.string(), prompt: z.string().min(1) }).parse(req.body);
		const agent = await db.agentDefinition.findFirst({ where: { id: body.agentId, organizationId: p.organizationId } });
		if (!agent) return reply.code(404).send({ ok: false, error: 'Agent 不存在或不属于本组织' });
		if (agent.status !== 'PUBLISHED') return reply.code(409).send({ ok: false, error: '只能对已发布 Agent 下达任务' });
		const version = await db.agentVersion.findUnique({ where: { agentId_version: { agentId: agent.id, version: agent.currentVersion } } });
		if (!version) return reply.code(409).send({ ok: false, error: 'Agent 没有已发布版本' });
		if (body.projectId) {
			const allowed = await assertProjectAccess(p.organizationId, body.projectId, p.userId, p.role);
			if (!allowed) return reply.code(403).send({ ok: false, error: '项目不存在或未授权' });
		}
		const task = await db.task.create({ data: { organizationId: p.organizationId, projectId: body.projectId || null, agentVersionId: version.id, title: body.prompt.slice(0, 80), prompt: body.prompt, createdBy: p.userId } });
		// 审查项①③：执行通道由环境决定（dsh=真实 DSH Runtime）；AgentGrant 装载能力并做事件白名单审计
		const grants = await db.agentGrant.findMany({ where: { agentId: agent.id } });
		const result = await runTask({ db, runtime: env.porosRuntime(), dshGrants: grants.map((g) => ({ kind: g.kind, name: g.name })) }, task.id);
		return { ok: true, taskId: task.id, run: result, runtime: env.porosRuntime() };
	});

	app.get('/api/tasks/:id/events', async (req, reply) => {
		const p = requirePrincipal(req, reply); if (!p) return;
		const { id } = idParam.parse(req.params);
		const task = await db.task.findFirst({ where: { id, organizationId: p.organizationId }, include: { runs: { orderBy: { startedAt: 'desc' }, take: 1 } } });
		if (!task) return reply.code(404).send({ ok: false, error: '任务不存在' });
		// 项目任务需要项目成员资格（审查项④：事件属于任务数据，与任务读取同一权限边界）
		if (task.projectId) {
			const allowed = await assertProjectAccess(p.organizationId, task.projectId, p.userId, p.role);
			if (!allowed) return reply.code(403).send({ ok: false, error: '项目任务事件未授权' });
		}
		// SSE 流式回放 + 实时追加（简化实现：先全量回放；runner 同步执行场景下事件已完整落库）
		reply.raw.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
		const run = task.runs[0];
		if (run) {
			const events = await db.runEvent.findMany({ where: { runId: run.id }, orderBy: { seq: 'asc' } });
			for (const ev of events) reply.raw.write(`event: ${ev.kind}\ndata: ${JSON.stringify({ seq: ev.seq, payload: ev.payload })}\n\n`);
		}
		reply.raw.write('event: done\ndata: {}\n\n');
		reply.raw.end();
	});

	// ---- 审批（职责分离：requireRoleExact，BUILDER 职级再高也无审批权——审查项④）----
	app.get('/api/approvals', async (req, reply) => {
		const p = requirePrincipal(req, reply); if (!p) return;
		if (!requireRoleExact(['REVIEWER', 'ADMIN'], p, reply)) return;
		const list = await db.approvalRequest.findMany({ where: { organizationId: p.organizationId }, orderBy: { createdAt: 'desc' }, take: 100 });
		return { ok: true, approvals: list };
	});

	app.post('/api/approvals/:id/decision', async (req, reply) => {
		const p = requirePrincipal(req, reply); if (!p) return;
		if (!requireRoleExact(['REVIEWER', 'ADMIN'], p, reply)) return;
		const { id } = idParam.parse(req.params);
		const body = z.object({ decision: z.enum(['APPROVED', 'REJECTED']) }).parse(req.body);
		const approval = await db.approvalRequest.findFirst({ where: { id, organizationId: p.organizationId, decision: 'PENDING' } });
		if (!approval) return reply.code(404).send({ ok: false, error: '审批单不存在或已决定' });
		const updated = await db.approvalRequest.update({ where: { id }, data: { decision: body.decision, decidedBy: p.userId, decidedAt: new Date() } });
		if (approval.kind === 'JUDGMENT_RULE' && body.decision === 'APPROVED') {
			await db.judgmentRule.updateMany({ where: { id: approval.subjectId, organizationId: p.organizationId }, data: { status: 'APPROVED', approvedBy: p.userId } });
		}
		return { ok: true, approval: updated };
	});

	// ---- Judgment ----
	app.post('/api/judgments/candidates', async (req, reply) => {
		const p = requirePrincipal(req, reply); if (!p) return;
		const body = z.object({
			rule: z.string().min(3),
			kind: z.enum(['MECHANICAL', 'SEMANTIC']).default('MECHANICAL'),
			scopeType: z.enum(['ORGANIZATION', 'DEPARTMENT', 'PROJECT', 'AGENT']),
			scopeId: z.string().min(1),
			sourceFeedback: z.string().min(1), // PRD §7.2：必须有显式反馈来源
			sourceRunId: z.string().default('')
		}).parse(req.body);
		if (body.scopeType === 'PROJECT') {
			const allowed = await assertProjectAccess(p.organizationId, body.scopeId, p.userId, p.role);
			if (!allowed) return reply.code(403).send({ ok: false, error: '项目不存在或未授权' });
		}
		const candidate = await db.judgmentRule.create({ data: { organizationId: p.organizationId, scopeType: body.scopeType, scopeId: body.scopeId, rule: body.rule, kind: body.kind, status: 'CANDIDATE', sourceFeedback: body.sourceFeedback, sourceRunId: body.sourceRunId } });
		await db.approvalRequest.create({ data: { organizationId: p.organizationId, kind: 'JUDGMENT_RULE', subjectId: candidate.id, requestedBy: p.userId } });
		return { ok: true, candidate };
	});

	app.post('/api/judgments/:id/disable', async (req, reply) => {
		const p = requirePrincipal(req, reply); if (!p) return;
		if (!requireRoleExact(['REVIEWER', 'ADMIN'], p, reply)) return;
		const { id } = idParam.parse(req.params);
		const rule = await db.judgmentRule.findFirst({ where: { id, organizationId: p.organizationId } });
		if (!rule) return reply.code(404).send({ ok: false, error: '规则不存在' });
		await db.judgmentRule.update({ where: { id }, data: { status: 'DISABLED' } });
		return { ok: true, status: 'DISABLED' };
	});

	app.get('/api/judgments', async (req, reply) => {
		const p = requirePrincipal(req, reply); if (!p) return;
		const rules = await db.judgmentRule.findMany({ where: { organizationId: p.organizationId }, include: { applications: { orderBy: { injectedAt: 'desc' }, take: 5 } }, orderBy: { createdAt: 'desc' } });
		return { ok: true, rules };
	});

	// ---- 文件（S3/MinIO + 元数据 + 权限）----
	app.post('/api/files', async (req, reply) => {
		const p = requirePrincipal(req, reply); if (!p) return;
		const body = z.object({ name: z.string().min(1), contentBase64: z.string(), projectId: z.string().optional(), sourceUrl: z.string().default('') }).parse(req.body);
		if (body.projectId) {
			const allowed = await assertProjectAccess(p.organizationId, body.projectId, p.userId, p.role);
			if (!allowed) return reply.code(403).send({ ok: false, error: '项目不存在或未授权' });
		}
		const buf = Buffer.from(body.contentBase64, 'base64');
		const key = storageKeyFor(p.organizationId, body.name);
		await putObject(key, buf);
		const file = await db.fileObject.create({ data: { organizationId: p.organizationId, projectId: body.projectId || null, name: body.name, storageKey: key, sizeBytes: buf.length, sourceUrl: body.sourceUrl, createdBy: p.userId } });
		return { ok: true, file };
	});

	// 下载票据：60 秒一次性，绑定文件+用户（审查项④：长效会话 Token 不进 URL）。
	// 流程：带 Authorization 头 POST download-ticket → <a href="?dl=<ticket>"> 短命链接。
	app.post('/api/files/:id/download-ticket', async (req, reply) => {
		const p = requirePrincipal(req, reply); if (!p) return;
		const { id } = idParam.parse(req.params);
		const file = await db.fileObject.findFirst({ where: { id, organizationId: p.organizationId } });
		if (!file) return reply.code(404).send({ ok: false, error: '文件不存在' });
		if (file.projectId) {
			const allowed = await assertProjectAccess(p.organizationId, file.projectId, p.userId, p.role);
			if (!allowed) return reply.code(403).send({ ok: false, error: '项目文件未授权' });
		}
		return { ok: true, ticket: signDownloadTicket(file.id, p.userId), expiresInSeconds: 60 };
	});

	app.get('/api/files/:id/download', async (req, reply) => {
		const { id } = idParam.parse(req.params);
		// 下载端点无 Authorization 头场景：只接受 60s 一次性票据（?dl=），不再接受会话 Token
		const q = (req.query as Record<string, unknown>)?.dl;
		const file = await db.fileObject.findFirst({ where: { id, organizationId: { not: '' } } });
		if (!file) return reply.code(404).send({ ok: false, error: '文件不存在' });
		if (typeof q !== 'string' || !q || !verifyDownloadTicket(q, file.id)) {
			return reply.code(401).send({ ok: false, error: '下载票据缺失或无效（POST /download-ticket 换取，60 秒有效）' });
		}
		const buf = await getObject(file.storageKey);
		reply.header('content-disposition', `attachment; filename="${encodeURIComponent(file.name)}"`);
		return reply.send(buf);
	});

	// ---- 集成状态（未配置如实标注，PRD §6.3）----
	app.get('/api/integrations/status', async () => {
		return {
			ok: true,
			modelGateway: env.modelGateway(),
			modelDisclaimer: env.modelGateway() === 'mock' ? '未配置真实模型服务' : '',
			kdocs: env.kdocsConfigured() ? 'configured' : '未配置/未验证真实服务（mock 契约测试）',
			ima: '未配置',
			tinyfish: '未配置'
		};
	});
}

// user_credentials 表（SQL 管理，保持 schema 精简）：迁移 SQL 在 prisma/migrations 中管理。
export const CREDENTIALS_DDL = `
CREATE TABLE IF NOT EXISTS user_credentials (
  email TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);`;
