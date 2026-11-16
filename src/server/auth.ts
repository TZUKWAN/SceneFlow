/**
 * 认证与授权（PRD §3.4：权限 = 组织策略 ∩ 用户身份 ∩ 项目授权 ∩ Agent 预授权 ∩ 本次任务同意）。
 * 服务端强制：任何跨作用域读取都过这里，前端隐藏不算授权。
 *
 * 角色语义（安全审查项④修正）：
 * - requireRole(min)：职级语义，高阶可代低阶（EMPLOYEE<REVIEWER<BUILDER<ADMIN）。
 *   只用于"能力更高者当然可做"的端点（如构建类）。
 * - requireRoleExact(roles)：显式集合，绝不级联。审批/裁决类端点必须用这个——
 *   BUILDER 职级高于 REVIEWER 但不因此获得审批权（职责分离）。
 */
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { getDb } from './db.js';
import { env } from './env.js';
import type { Role } from '@prisma/client';

export interface Principal {
	userId: string;
	organizationId: string;
	role: Role;
	email: string;
}

export function hashPassword(plain: string): string {
	return bcrypt.hashSync(plain, 10);
}

export function verifyPassword(plain: string, hashed: string): boolean {
	return bcrypt.compareSync(plain, hashed);
}

export function signSession(p: Principal): string {
	return jwt.sign(p, env.jwtSecret(), { expiresIn: '12h' });
}

export function verifySession(token: string): Principal | null {
	try {
		const decoded = jwt.verify(token, env.jwtSecret());
		if (typeof decoded !== 'object' || decoded === null) return null;
		const d = decoded as Record<string, unknown>;
		if (typeof d.userId !== 'string' || typeof d.organizationId !== 'string' || typeof d.role !== 'string' || typeof d.email !== 'string') return null;
		return { userId: d.userId, organizationId: d.organizationId, role: d.role as Role, email: d.email };
	} catch {
		return null;
	}
}

// ---- 一次性下载票据（审查项④：长效会话 Token 不进 URL）----
// <a href> 下载无法携带 Authorization 头；改用 60 秒一次性票据，绑定文件与用户，
// 由受信 API（POST download-ticket，走 Authorization 头）换取。URL 里只出现短命票据。
export function signDownloadTicket(fileId: string, userId: string): string {
	return jwt.sign({ purpose: 'file-download', fileId, userId }, env.jwtSecret(), { expiresIn: '60s' });
}

export function verifyDownloadTicket(ticket: string, fileId: string): boolean {
	try {
		const decoded = jwt.verify(ticket, env.jwtSecret());
		if (typeof decoded !== 'object' || decoded === null) return false;
		const d = decoded as Record<string, unknown>;
		// 票据本身即 60 秒 bearer 凭证（签发时已做过组织+项目校验）；下载端点无会话，不与 principal 绑定比对
		return d.purpose === 'file-download' && d.fileId === fileId && typeof d.userId === 'string';
	} catch {
		return false;
	}
}

declare module 'fastify' {
	interface FastifyRequest {
		principal: Principal | null;
	}
}

export async function authMiddleware(req: FastifyRequest): Promise<void> {
	req.principal = null;
	// 只认 Authorization 头（审查项④：不再接受 ?token= 查询串——URL 会被日志/代理/历史记录留存）
	const header = req.headers.authorization || '';
	if (!header.startsWith('Bearer ')) return;
	const p = verifySession(header.slice(7));
	if (!p) return;
	// 会话签发后成员可能已被移除：每次请求核对成员资格（拒绝已被踢出的用户）。
	const member = await getDb().membership.findUnique({ where: { organizationId_userId: { organizationId: p.organizationId, userId: p.userId } } });
	if (!member) return;
	req.principal = { ...p, role: member.role };
}

export function requirePrincipal(req: FastifyRequest, reply: FastifyReply): Principal | null {
	if (!req.principal) { reply.code(401).send({ ok: false, error: '未认证' }); return null; }
	return req.principal;
}

export function requireRole(min: Role[], p: Principal, reply: FastifyReply): boolean {
	const order: Record<Role, number> = { EMPLOYEE: 1, REVIEWER: 2, BUILDER: 3, ADMIN: 4 };
	const okRole = min.some((r) => order[p.role] >= order[r]);
	if (!okRole) reply.code(403).send({ ok: false, error: `需要角色 ${min.join('/')}，当前 ${p.role}` });
	return okRole;
}

/** 显式角色集合（无级联）：审批/裁决类端点专用。BUILDER 不能因职级高而获得审批权。 */
export function requireRoleExact(roles: Role[], p: Principal, reply: FastifyReply): boolean {
	if (!roles.includes(p.role)) {
		reply.code(403).send({ ok: false, error: `需要角色 ${roles.join('/')}（职责分离，不接受更高职级替代），当前 ${p.role}` });
		return false;
	}
	return true;
}

/** 项目授权检查：项目必须属于本组织且用户在成员表内（ADMIN 例外）。 */
export async function assertProjectAccess(organizationId: string, projectId: string, userId: string, role: Role): Promise<boolean> {
	const db = getDb();
	const project = await db.project.findFirst({ where: { id: projectId, organizationId } });
	if (!project) return false;
	if (role === 'ADMIN') return true;
	const m = await db.projectMember.findUnique({ where: { projectId_userId: { projectId, userId } } });
	return !!m;
}
