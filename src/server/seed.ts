/**
 * 种子：组织 A（管理员/构建者/员工/审阅者 + 项目）与组织 B（隔离负向测试用）。
 * 密码全部为 bcrypt 哈希；仅用于开发/CI，生产禁用种子。
 * seedForTests() 供验收测试独立调用（幂等 upsert）。
 */
import { getDb, closeDb } from './db.js';
import { hashPassword } from './auth.js';
import { CREDENTIALS_DDL } from './routes/index.js';

export async function seedForTests(): Promise<void> {
	const db = getDb();
	await db.$executeRawUnsafe(CREDENTIALS_DDL);
	const orgA = await db.organization.upsert({ where: { id: 'org-a' }, create: { id: 'org-a', name: '组织A（验收）' }, update: {} });
	const orgB = await db.organization.upsert({ where: { id: 'org-b' }, create: { id: 'org-b', name: '组织B（隔离负向）' }, update: {} });

	const ensureUser = async (email: string, password: string, organizationId: string, role: 'ADMIN' | 'BUILDER' | 'EMPLOYEE' | 'REVIEWER') => {
		await db.$executeRawUnsafe('INSERT INTO user_credentials(email, password_hash) VALUES ($1,$2) ON CONFLICT (email) DO UPDATE SET password_hash=$2', email, hashPassword(password));
		await db.membership.upsert({ where: { organizationId_userId: { organizationId, userId: email } }, create: { organizationId, userId: email, role }, update: { role } });
	};

	await ensureUser('admin@a.test', 'admin-pass-123', orgA.id, 'ADMIN');
	await ensureUser('builder@a.test', 'builder-pass-123', orgA.id, 'BUILDER');
	await ensureUser('employee@a.test', 'employee-pass-123', orgA.id, 'EMPLOYEE');
	await ensureUser('reviewer@a.test', 'reviewer-pass-123', orgA.id, 'REVIEWER');
	await ensureUser('outsider@b.test', 'outsider-pass-123', orgB.id, 'EMPLOYEE');

	const project = await db.project.upsert({ where: { id: 'proj-market' }, create: { id: 'proj-market', organizationId: orgA.id, name: '市场洞察' }, update: {} });
	for (const u of ['admin@a.test', 'builder@a.test', 'employee@a.test', 'reviewer@a.test']) {
		await db.projectMember.upsert({ where: { projectId_userId: { projectId: project.id, userId: u } }, create: { projectId: project.id, userId: u }, update: {} });
	}
	// 受限项目：仅管理员在册（AUTH-02/审查项④：任务事件等项目数据的跨成员负向测试用）
	const exec = await db.project.upsert({ where: { id: 'proj-exec' }, create: { id: 'proj-exec', organizationId: orgA.id, name: '高管专属（隔离用）' }, update: {} });
	await db.projectMember.upsert({ where: { projectId_userId: { projectId: exec.id, userId: 'admin@a.test' } }, create: { projectId: exec.id, userId: 'admin@a.test' }, update: {} });
}

async function main() {
	await seedForTests();
	console.log('seeded: org-a(4 角色+项目), org-b(outsider)。密码见脚本常量，仅开发用。');
	await closeDb();
}

if (process.argv[1] && process.argv[1].endsWith('seed.ts')) {
	main().catch(async (e) => { console.error(e); await closeDb(); process.exit(1); });
}
