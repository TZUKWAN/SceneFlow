/**
 * 语义 Judge 单测（PRD §7.2 fail-open 语义）：
 * - mock 网关 → 无 judge（null，语义规则如实 UNCHECKED，绝不 mock 判 PASS 伪绿）
 * - judge 输出正常 → 逐条 PASS/FAIL
 * - JSON 解析失败 / 缺 verdicts / 缺单条裁决 / 调用抛错 → 全部/对应 UNCHECKED
 * - 成本统计 modelCalls=1（每 run ≤1 次语义评估调用）
 */
import { describe, expect, it } from 'vitest';
import { createSemanticJudge } from '../../src/server/semantic-judge.js';
import { MockGateway } from '../../src/server/model-gateway.js';
import type { EffectiveRule } from '../../src/server/judgment.js';

const rules: EffectiveRule[] = [
	{ id: 'r1', version: 1, rule: '语气正式', kind: 'SEMANTIC', scopeType: 'ORGANIZATION', scopeId: 'org-a' },
	{ id: 'r2', version: 1, rule: '结论先行', kind: 'SEMANTIC', scopeType: 'ORGANIZATION', scopeId: 'org-a' }
];

describe('语义 Judge fail-open 语义（审查项⑥镜像）', () => {
	it('mock 网关 → 无语义 Judge（null），语义规则 UNCHECKED 不伪绿', () => {
		expect(createSemanticJudge(new MockGateway())).toBeNull();
	});

	it('judge 正常输出 → 逐条 PASS/FAIL', async () => {
		const gw = {
			name: 'deepseek',
			generate: async () => ({ output: '{"verdicts":[{"id":"r1","pass":true,"reason":"语气正式"},{"id":"r2","pass":false,"reason":"结论在中间"}]}', gateway: 'deepseek', disclaimer: '' }),
			draftAgent: async () => { throw new Error('unused'); }
		};
		const judge = createSemanticJudge(gw);
		expect(judge).not.toBeNull();
		const { verdicts, modelCalls } = await judge!.judge(rules, '产出文本');
		expect(modelCalls).toBe(1);
		expect(verdicts.get('r1')).toEqual({ status: 'PASS', reason: '语气正式' });
		expect(verdicts.get('r2')!.status).toBe('FAIL');
	});

	it('JSON 解析失败 → 全部 UNCHECKED（绝不 PASS）', async () => {
		const gw = { name: 'deepseek', generate: async () => ({ output: '这不是 JSON', gateway: 'deepseek', disclaimer: '' }), draftAgent: async () => { throw new Error('unused'); } };
		const { verdicts, modelCalls } = await createSemanticJudge(gw)!.judge(rules, 'x');
		expect(modelCalls).toBe(1);
		for (const r of rules) expect(verdicts.get(r.id)!.status).toBe('UNCHECKED');
	});

	it('缺 verdicts 数组 / 缺单条裁决 → 对应 UNCHECKED（不补猜）', async () => {
		const gw1 = { name: 'deepseek', generate: async () => ({ output: '{"wrong":1}', gateway: 'deepseek', disclaimer: '' }), draftAgent: async () => { throw new Error('unused'); } };
		const a = await createSemanticJudge(gw1)!.judge(rules, 'x');
		expect(a.verdicts.get('r1')!.status).toBe('UNCHECKED');
		const gw2 = { name: 'deepseek', generate: async () => ({ output: '{"verdicts":[{"id":"r1","pass":true}]}', gateway: 'deepseek', disclaimer: '' }), draftAgent: async () => { throw new Error('unused'); } };
		const b = await createSemanticJudge(gw2)!.judge(rules, 'x');
		expect(b.verdicts.get('r1')!.status).toBe('PASS');
		expect(b.verdicts.get('r2')!.status).toBe('UNCHECKED');
		expect(b.verdicts.get('r2')!.reason).toContain('不补猜');
	});

	it('网关抛错 → 全部 UNCHECKED 且原因带调用失败', async () => {
		const gw = { name: 'deepseek', generate: async () => { throw new Error('HTTP 503'); }, draftAgent: async () => { throw new Error('unused'); } };
		const { verdicts } = await createSemanticJudge(gw)!.judge(rules, 'x');
		for (const r of rules) {
			expect(verdicts.get(r.id)!.status).toBe('UNCHECKED');
			expect(verdicts.get(r.id)!.reason).toContain('judge 调用失败');
		}
	});

	it('pass 非布尔 → UNCHECKED', async () => {
		const gw = { name: 'deepseek', generate: async () => ({ output: '{"verdicts":[{"id":"r1","pass":"yes"}]}', gateway: 'deepseek', disclaimer: '' }), draftAgent: async () => { throw new Error('unused'); } };
		const { verdicts } = await createSemanticJudge(gw)!.judge([rules[0]!], 'x');
		expect(verdicts.get('r1')!.status).toBe('UNCHECKED');
	});
});
