/**
 * Judgment Layer V2（PRD §7 语义落地）。与旧 ledger 的区别（§1.2 六条错误全部规避）：
 * - 没有自动晋级、没有 holdout 因果推断、没有 silent-accepted；
 * - candidate 只能来自显式用户反馈或机器可观测失败（路由层强制 source）；
 * - 只有 APPROVED 规则才进入正式运行注入；注入逐条留痕 ruleId+version；
 * - 评估：机械规则确定性检查；语义规则无 Judge 时恒为 UNCHECKED（绝不记 PASS）。
 */
import type { JudgmentRule, PrismaClient, ScopeType } from '@prisma/client';

export interface EffectiveRule {
	id: string;
	version: number;
	rule: string;
	kind: 'MECHANICAL' | 'SEMANTIC';
	scopeType: ScopeType;
	scopeId: string;
}

/** 作用域筛选：组织 > 部门 > 项目 > Agent，窄作用域优先；只取 APPROVED。 */
export async function effectiveRules(db: PrismaClient, organizationId: string, context: { projectId?: string | null; agentId?: string | null; department?: string | null }): Promise<EffectiveRule[]> {
	const rows = await db.judgmentRule.findMany({ where: { organizationId, status: 'APPROVED' } });
	const matches = rows.filter((r) => {
		if (r.scopeType === 'ORGANIZATION') return true;
		if (r.scopeType === 'DEPARTMENT') return !!context.department && r.scopeId === context.department;
		if (r.scopeType === 'PROJECT') return !!context.projectId && r.scopeId === context.projectId;
		if (r.scopeType === 'AGENT') return !!context.agentId && r.scopeId === context.agentId;
		return false;
	});
	// 同 scope 下版本去重：只取每个 rule 的最大 version
	const byId = new Map<string, JudgmentRule>();
	for (const r of matches) {
		const prev = byId.get(r.id);
		if (!prev || r.version > prev.version) byId.set(r.id, r);
	}
	return [...byId.values()].map((r) => ({ id: r.id, version: r.version, rule: r.rule, kind: r.kind, scopeType: r.scopeType, scopeId: r.scopeId }));
}

/** 机械规则：确定性检查（可审计、无模型参与）。规则语法约定：
 *   must_contain:<substring>   输出必须包含子串
 *   must_not_contain:<substring> 输出必须不包含
 *   max_length:<n>             输出长度上限
 * 未知机械规则 → UNCHECKED（保守，不猜）。
 */
export function evaluateMechanical(rule: string, output: string): { status: 'PASS' | 'FAIL' | 'UNCHECKED'; reason: string } {
	const [head, ...rest] = rule.split(':');
	const arg = rest.join(':');
	switch (head) {
		case 'must_contain':
			return output.includes(arg) ? { status: 'PASS', reason: '' } : { status: 'FAIL', reason: `输出缺少必需内容: ${arg}` };
		case 'must_not_contain':
			return output.includes(arg) ? { status: 'FAIL', reason: `输出包含禁止内容: ${arg}` } : { status: 'PASS', reason: '' };
		case 'max_length': {
			const n = Number(arg);
			if (!Number.isFinite(n)) return { status: 'UNCHECKED', reason: `无法解析长度上限: ${arg}` };
			return output.length <= n ? { status: 'PASS', reason: '' } : { status: 'FAIL', reason: `输出长度 ${output.length} 超过上限 ${n}` };
		}
		default:
			return { status: 'UNCHECKED', reason: `未知机械规则指令: ${head}` };
	}
}
