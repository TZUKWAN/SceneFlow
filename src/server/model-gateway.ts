/**
 * 模型网关（PRD §6.3）：统一准入。
 * - mock：默认。契约真实的模拟网关——返回结构化输出并明确标注"未配置真实模型服务"。
 * - deepseek：真实 DeepSeek API。仅在 POROS_DEEPSEEK_API_KEY 存在时可用；
 *   密钥缺失时 refuses（绝不静默降级到未授权公共免费网关，PRD SEC-02）。
 * 任何网页/工具/文档内容都是不可信输入：prompt 只做数据拼入，不做指令提升。
 */
import { env } from './env.js';

export interface GatewayResult {
	output: string;
	gateway: string;
	disclaimer: string;
}

export interface AgentDraft {
	name: string;
	description: string;
	department: string;
	config: { persona: string; modelPolicy: string; outputKind: string; tools: string[] };
}

export interface ModelGateway {
	name: string;
	generate(prompt: string, system: string): Promise<GatewayResult>;
	/** 审查项②：自然语言 → 结构化 AgentDefinition 草稿（LLM 生成，zod 在路由层校验） */
	draftAgent(description: string): Promise<AgentDraft>;
}

function draftFromDescription(name: string, description: string): AgentDraft {
	const clean = description.replace(/\s+/g, ' ').trim();
	const headline = clean.slice(0, 60);
	return {
		name: name || headline.slice(0, 12) || '未命名 Agent',
		description: clean.slice(0, 400),
		department: '',
		config: {
			persona: `你是组织内受治理的 Agent。职责：${headline}。严格在授权能力范围内工作，输出必须可核验。`,
			modelPolicy: 'default',
			outputKind: /报告|总结|文档/.test(clean) ? 'markdown-document' : 'chat-answer',
			tools: []
		}
	};
}

export class MockGateway implements ModelGateway {
	name = 'mock';
	async draftAgent(description: string): Promise<AgentDraft> {
		const d = draftFromDescription('', description);
		return { ...d, config: { ...d.config, modelPolicy: 'mock（未配置真实模型服务）' } };
	}
	async generate(prompt: string, system: string): Promise<GatewayResult> {
		const output = [
			'【mock 网关输出·未配置真实模型服务】',
			'已接收任务并生成结构化占位结果：',
			'- 任务摘要: ' + prompt.slice(0, 120).replace(/\s+/g, ' '),
			'- 系统约束: ' + (system ? system.slice(0, 120).replace(/\s+/g, ' ') : '(无)'),
			'- 引用来源: mock 占位（真实运行时此处列出来源链接）',
			'- 结论: 这是契约测试输出，用于验证运行/注入/评估/审计链路；接入真实模型网关后此段由模型生成。'
		].join('\n');
		return { output, gateway: this.name, disclaimer: '未配置真实模型服务（MODEL_GATEWAY=mock）' };
	}
}

class DeepSeekGateway implements ModelGateway {
	name = 'deepseek';
	async draftAgent(description: string): Promise<AgentDraft> {
		const key = env.deepseekApiKey();
		if (!key) throw new Error('DeepSeek 网关未配置 POROS_DEEPSEEK_API_KEY：拒绝静默降级（SEC-02）');
		const sys = '你是 Poros Agent Builder。把用户的自然语言描述转成结构化 Agent 草稿 JSON，字段：name(≤12字)、department、config.persona(职责+边界)、config.outputKind(markdown-document|chat-answer)、config.tools(空数组，能力由授权表管理)。只输出 JSON。';
		const res = await fetch('https://api.deepseek.com/chat/completions', {
			method: 'POST',
			headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
			body: JSON.stringify({ model: 'deepseek-chat', messages: [{ role: 'system', content: sys }, { role: 'user', content: description }], response_format: { type: 'json_object' } })
		});
		if (!res.ok) throw new Error(`DeepSeek 网关错误: HTTP ${res.status}`);
		const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
		const raw = JSON.parse(data.choices?.[0]?.message?.content ?? '{}') as Partial<AgentDraft>;
		const fallback = draftFromDescription('', description);
		return {
			name: String(raw.name ?? fallback.name).slice(0, 40),
			description: String(raw.description ?? fallback.description),
			department: String(raw.department ?? ''),
			config: { ...fallback.config, ...(raw.config ?? {}), tools: Array.isArray(raw.config?.tools) ? raw.config!.tools : [] }
		};
	}
	async generate(prompt: string, system: string): Promise<GatewayResult> {
		const key = env.deepseekApiKey();
		if (!key) throw new Error('DeepSeek 网关未配置 POROS_DEEPSEEK_API_KEY：拒绝静默降级到未授权公共网关（SEC-02）');
		const res = await fetch('https://api.deepseek.com/chat/completions', {
			method: 'POST',
			headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
			body: JSON.stringify({ model: 'deepseek-chat', messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }] })
		});
		if (!res.ok) throw new Error(`DeepSeek 网关错误: HTTP ${res.status}`);
		const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
		return { output: data.choices?.[0]?.message?.content ?? '', gateway: this.name, disclaimer: '' };
	}
}

export function createGateway(): ModelGateway {
	const kind = env.modelGateway();
	if (kind === 'deepseek') return new DeepSeekGateway();
	return new MockGateway();
}
