/**
 * Fastify 应用组装。导出 buildApp 供 API 测试用 inject 模式（不起端口）。
 * 错误契约（PRD §7.2/§5.2）：任何异常 → 真实错误响应，绝不 catch 后返回 ok:true。
 */
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import { authMiddleware } from './auth.js';
import { registerRoutes, CREDENTIALS_DDL } from './routes/index.js';
import { getDb } from './db.js';

export async function buildApp(): Promise<FastifyInstance> {
	const app = Fastify({ logger: { level: process.env.LOG_LEVEL || 'info' } });
	app.setErrorHandler((error, _req, reply) => {
		if (error instanceof ZodError) {
			return reply.code(400).send({ ok: false, error: '参数校验失败', issues: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
		}
		app.log.error({ err: error }, 'request failed');
		const status = (error as { statusCode?: number }).statusCode || 500;
		return reply.code(status).send({ ok: false, error: status >= 500 ? '内部错误' : error.message });
	});
	app.addHook('onRequest', authMiddleware);
	app.get('/api/health', async () => ({ ok: true, service: 'poros' }));
	await app.register(registerRoutes);
	const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
	await app.register(fastifyStatic, { root: publicDir, prefix: '/' });
	app.setNotFoundHandler((req, reply) => {
		if (req.raw.method === 'GET' && !req.raw.url?.startsWith('/api')) return reply.sendFile('index.html');
		return reply.code(404).send({ ok: false, error: '不存在' });
	});
	// 凭证表（最小 SQL 管理，见 CREDENTIALS_DDL 注释）
	await getDb().$executeRawUnsafe(CREDENTIALS_DDL);
	return app;
}
