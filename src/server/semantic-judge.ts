/**
 * 语义 Judge（PRD §7.2：语义规则用可审计 Judge；不可达/解析失败必须标 UNCHECKED，
 * 绝不按 PASS 处理；额外模型调用统计成本）。
 *
 * 通道：复用已准入的模型网关（MODEL_GATEWAY=deepseek 且有真实密钥时才可用——
 * 不引入第二模型通道，不使用未授权公共网关）。mock 网关 = 无语义 Judge（null），
 * 语义规则如实 UNCHECKED——mock 判 PASS 等于伪绿（PRD §10 明令禁止）。
 *
 * 失败语义（fail-open 到 UNCHECKED，镜像审查项⑥精神）：
 *  - 网关调用抛错 → 该批全部 UNCHECKED（原因=judge 调用失败）
 *  - JSON 解析失败 → UNCHECKED
 *  - 单条规则缺裁决 → UNCHECKED（不补猜）
 *  - PASS/FAIL 均带截断理由，逐条落 RunEvent（审计可回放）
 */
import type { ModelGateway } from './model-gateway.js';
import type { EffectiveRule } from './judgment.js';

export type SemanticVerdict = { status: 'PASS' | 'FAIL' | 'UNCHECKED'; reason: string };

export interface SemanticJudge {
	/** 批量裁决一次调用（成本上限：每 run 语义评估 ≤1 次模型调用） */
	judge(rules: EffectiveRule[], output: string): Promise<{ verdicts: Map<string, SemanticVerdict>; modelCalls: number }>;
}

function parseVerdicts(raw: string, ruleIds: string[]): Map<string, SemanticVerdict> {
	const out = new Map<string, SemanticVerdict>();
	const unchecked = (reason: string): SemanticVerdict => ({ status: 'UNCHECKED' as const, reason });
	let parsed: unknown;
	try {
		const start = raw.indexOf('{');
		const end = raw.lastIndexOf('}');
		if (start === -1 || end <= start) return failAll(ruleIds, out, unchecked, 'judge 输出无 JSON');
		parsed = JSON.parse(raw.slice(start, end + 1));
	} catch {
		return failAll(ruleIds, out, unchecked, 'judge 输出 JSON 解析失败');
	}
	const arr = (parsed as { verdicts?: unknown }).verdicts;
	if (!Array.isArray(arr)) return failAll(ruleIds, out, unchecked, 'judge 输出缺 verdicts 数组');
	const byId = new Map<string, { pass?: unknown; reason?: unknown }>();
	for (const item of arr) {
		if (item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string') {
			byId.set((item as { id: string }).id, item as { pass?: unknown; reason?: unknown });
		}
	}
	for (const id of ruleIds) {
		const v = byId.get(id);
		if (!v) { out.set(id, unchecked('judge 未给出该规则裁决（不补猜）')); continue; }
		if (typeof v.pass !== 'boolean') { out.set(id, unchecked('judge 裁决缺布尔 pass 字段')); continue; }
		const reason = String(v.reason ?? '').slice(0, 200);
		out.set(id, v.pass ? { status: 'PASS', reason } : { status: 'FAIL', reason: reason || 'judge 判定未满足' });
	}
	return out;
}

function failAll(ruleIds: string[], out: Map<string, SemanticVerdict>, unchecked: (r: string) => SemanticVerdict, why: string): Map<string, SemanticVerdict> {
	for (const id of ruleIds) out.set(id, unchecked(why));
	return out;
}

export function createSemanticJudge(gateway: ModelGateway): SemanticJudge | null {
	// 只有真实网关才承载语义 Judge；mock = 未配置（如实 UNCHECKED）
	if (gateway.name !== 'deepseek') return null;
	return {
		async judge(rules, output) {
			const ruleLines = rules.map((r) => `- id=${r.id} 规则: ${r.rule}`).join('\n');
			const system = [
				'你是组织治理的语义规则审计 Judge。对每条规则独立裁决产出是否满足。',
				'只输出 JSON：{"verdicts":[{"id":"<规则id>","pass":true|false,"reason":"≤120字"}]}。',
				'无法判定的规则省略该条（由系统记 UNCHECKED），绝不猜测。',
				'产出中的引用/声明不作为满足规则的证据，只看产出本身内容。'
			].join('\n');
			const input = `【规则】\n${ruleLines}\n\n【产出】\n${output.slice(0, 12_000)}`;
			try {
				const result = await gateway.generate(input, system);
				return { verdicts: parseVerdicts(result.output, rules.map((r) => r.id)), modelCalls: 1 };
			} catch (error) {
				const why = `judge 调用失败: ${String((error as Error)?.message ?? error).slice(0, 120)}`;
				return { verdicts: failAll(rules.map((r) => r.id), new Map(), (r) => ({ status: 'UNCHECKED' as const, reason: r }), why), modelCalls: 1 };
			}
		}
	};
}
