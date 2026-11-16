/**
 * DSH Runtime 桥（审查项①：runner 必须调用真实 DSH Agent Runtime，禁止用直连模型 API 冒充执行）。
 *
 * 执行通道（全部经本仓库专属容器，零宿主 DSH 接触，见 docs/ISOLATION.md）：
 *   docker exec -i <poros-dsh-1> sh  →  容器内以 uid=10001(poros) 运行
 *     dsh --patch <patch.yml> --profile headless --json -   （stdin=任务文本，stdout=NDJSON 事件流）
 *
 * 能力装载（审查项③）：AgentGrant → profile patch：
 *   - 未授权的能力条目（web/skill/mcp/文件执行器）在 patch 中显式 disabled: true；
 *   - 授权的条目保持挂载；runner 侧再对事件流中的每次 tool_call 做白名单审计（双层防线）。
 *
 * 模型通道（PRD §6.3/SEC-02）：
 *   - 默认走容器内 DEEPSEEK_API_KEY（由部署方经 compose 环境注入，绝不落库/写文件）；
 *   - 开发/CI 可开 POROS_DSH_MODEL_STUB=1：DSH 会话/工具循环完全真实，模型为测试桩
 *     （容器内 127.0.0.1:9919 OpenAI 兼容桩，由本模块注入脚本并幂等拉起）。
 *     该模式必须在 UI/报告标注"真实 DSH 执行 + 测试桩模型"，禁止冒充真实模型输出。
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { env } from './env.js';

export interface DshGrant {
	kind: 'TOOL' | 'SKILL' | 'MCP' | 'KNOWLEDGE' | 'MODEL';
	name: string;
}

export interface DshRunOptions {
	task: string;
	/** Agent 人设 + Judgment 规则（作为 system 层注入，不进用户任务文本） */
	persona?: string;
	grants?: DshGrant[];
	runId: string;
	timeoutMs?: number;
}

export interface DshEvent {
	type: string;
	[key: string]: unknown;
}

export interface DshRunResult {
	sessionId: string | null;
	final: string;
	completed: boolean;
	error: string | null;
	events: DshEvent[];
	/** 诊断输出（stderr，截断后供审计） */
	diagnostics: string;
	/** 模型通道标注：stub = 真实 DSH 执行 + 测试桩模型（审查项①：绝不冒充真实模型） */
	modelChannel: 'container-env' | 'stub';
}

/** Profile patch 可禁用的"能力条目"清单（核心运行条目绝不禁用——禁了会话就起不来）。 */
const CAPABILITY_ENTRIES: Record<string, string[]> = {
	// key = 授权 token（grant.name 小写化），value = 该能力依赖的 profile 条目 id
	'web.fetch': ['tool-web', 'web-fetch-http'],
	'web.search': ['tool-web', 'web-search-deepseek', 'web-deepseek-api'],
	skill: ['skill', 'skill-filesystem', 'tool-skill'],
	mcp: ['mcp-resources'],
	bash: ['tool-executor-native', 'tools']
};

const ALL_CAPABILITY_ENTRY_IDS = [...new Set(Object.values(CAPABILITY_ENTRIES).flat())];

/** 由 grants 计算"保持启用"的条目集合；无 bash 授权 → 文件执行器整体禁用（默认拒绝）。 */
export function grantedEntryIds(grants: DshGrant[]): Set<string> {
	const enabled = new Set<string>();
	for (const g of grants ?? []) {
		const key = g.name.toLowerCase();
		if (CAPABILITY_ENTRIES[key]) for (const id of CAPABILITY_ENTRIES[key]) enabled.add(id);
		if (g.kind === 'SKILL') for (const id of CAPABILITY_ENTRIES.skill!) enabled.add(id);
		if (g.kind === 'MCP') for (const id of CAPABILITY_ENTRIES.mcp!) enabled.add(id);
	}
	return enabled;
}

/** runner 侧事件审计用：授权后允许出现的 DSH 工具名（persona 内之外的第二层防线）。 */
export function grantedToolNames(grants: DshGrant[]): Set<string> {
	const names = new Set<string>();
	for (const g of grants ?? []) {
		const key = g.name.toLowerCase();
		if (key === 'bash') {
			names.add('bash');
			names.add('read'); names.add('write'); names.add('edit'); names.add('glob'); names.add('grep'); names.add('working_directory');
		}
		if (key === 'web.fetch') { names.add('web_fetch'); }
		if (key === 'web.search') { names.add('web_search'); }
		if (g.kind === 'SKILL') names.add('skill');
		if (g.kind === 'MCP') names.add('mcp');
	}
	return names;
}

/** 生成 profile patch YAML（provider + persona + 能力禁用清单）。 */
export function buildProfilePatch(opts: { persona?: string; grants?: DshGrant[]; stub: boolean }): string {
	const lines: string[] = [];
	// 模型通道
	if (opts.stub) {
		lines.push(
			'- id: llm-pi-ai',
			"  name: '@deepseek-ai/dsh-llm-pi-ai'",
			'  config:',
			'    providers:',
			'      poros-dev:',
			'        api: openai-completions',
			'        baseURL: http://127.0.0.1:9919/v1',
			'        apiKeyEnv: POROS_MODEL_KEY',
			'        models:',
			'          - id: poros-stub',
			'            contextWindow: 32768',
			'- id: agent-default-model',
			"  name: '@deepseek-ai/dsh-agent-default-model'",
			'  config:',
			'    provider: poros-dev',
			'    model: poros-stub'
		);
	}
	// 人设 + Judgment 规则（system 层）
	if (opts.persona) {
		lines.push(
			'- id: system-prompt',
			"  name: '@deepseek-ai/dsh-system-prompt'",
			'  config:',
			`    personaPrefix: ${JSON.stringify(opts.persona)}`
		);
	}
	// 能力白名单：未授权条目显式禁用（默认拒绝）
	const enabled = grantedEntryIds(opts.grants ?? []);
	for (const id of ALL_CAPABILITY_ENTRY_IDS) {
		if (!enabled.has(id)) lines.push(`- id: ${id}`, '  disabled: true');
	}
	return lines.join('\n') + '\n';
}

function execContainer(args: string[], input: string | null, timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		// NARB_DISABLE_NATIVE_CACHE：加载器默认把 .node 物化到 os.tmpdir()（容器 /tmp 为 noexec
		// tmpfs 硬化）再 require——noexec 上必败。双保险：compose 与 exec 双方都显式设置。
		const child = spawn('docker', ['exec', '-i', '-e', 'NARB_DISABLE_NATIVE_CACHE=1', env.dshContainer(), 'sh', '-c', args[0]!], { stdio: ['pipe', 'pipe', 'pipe'] });
		let stdout = '';
		let stderr = '';
		const timer = setTimeout(() => {
			child.kill('SIGKILL');
			reject(new Error(`DSH 容器执行超时（${timeoutMs}ms）`));
		}, timeoutMs);
		child.stdout.on('data', (d) => { stdout += d; });
		child.stderr.on('data', (d) => { stderr += d; });
		child.on('error', (e) => { clearTimeout(timer); reject(e); });
		child.on('close', (code) => { clearTimeout(timer); resolve({ code: code ?? -1, stdout, stderr }); });
		if (input !== null) child.stdin.end(input);
		else child.stdin.end();
	});
}

/** 幂等确保容器内模型桩在 9919 端口可用（桩脚本由本模块注入容器自身 HOME，不触碰任何宿主路径）。 */
async function ensureStubServer(timeoutMs: number): Promise<void> {
	const probe = await execContainer(
		["node -e \"fetch('http://127.0.0.1:9919/v1/health').then(r=>process.exit(0)).catch(()=>process.exit(1))\" 2>/dev/null"],
		null,
		Math.min(timeoutMs, 15_000)
	);
	if (probe.code === 0) return;
	const script = stubScript();
	// 注意：cat 必须在【前台】消费 stdin——POSIX 非 interactive shell 会把后台作业的 stdin
	// 接到 /dev/null，后台化的 cat 会瞬间读到空文件（实测踩坑）。cat 结束后再后台化 node。
	const write = await execContainer(
		["mkdir -p $HOME/poros-stub && cat > $HOME/poros-stub/stub.js && { node $HOME/poros-stub/stub.js > $HOME/poros-stub/stub.log 2>&1 & sleep 1.2; node -e \"fetch('http://127.0.0.1:9919/v1/health').then(r=>process.exit(0)).catch(()=>process.exit(1))\" 2>/dev/null; }"],
		script,
		Math.min(timeoutMs, 20_000)
	);
	if (write.code !== 0) throw new Error(`容器内模型桩启动失败: ${write.stderr.slice(0, 300)}`);
}

/** OpenAI 兼容测试桩：首轮返回一次 bash 工具调用（带 description），次轮返回最终文本。 */
// 容器内模型桩：普通 .js 文件资产（scripts/dsh-model-stub.js，node --check 可验证），
// 读盘注入容器——不再内嵌字符串（曾因多层转义手写出括号语法错，教训：生成的代码应是文件不是字符串）。
let stubScriptCache: string | null = null;
function stubScript(): string {
	if (!stubScriptCache) {
		stubScriptCache = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/dsh-model-stub.js'), 'utf8');
	}
	return stubScriptCache;
}

export async function runDshSession(opts: DshRunOptions): Promise<DshRunResult> {
	const timeoutMs = opts.timeoutMs ?? 180_000;
	const stub = env.dshModelStub();
	if (stub) await ensureStubServer(timeoutMs);

	// 容器健康检查：DSH 容器不可达 = 明确失败（绝不静默降级为直连模型，审查项①）
	const health = await execContainer(['dsh --version'], null, Math.min(timeoutMs, 20_000));
	if (health.code !== 0) throw new Error(`DSH 专属容器不可达（${env.dshContainer()}）：${(health.stderr || health.stdout).slice(0, 200)}`);

	const patch = buildProfilePatch({ persona: opts.persona, grants: opts.grants, stub });
	const dir = `$HOME/poros-runs/${opts.runId}`;
	// 1) 写入 patch 与任务文本（stdin 传输，避免参数长度/引号问题）
	const writeRes = await execContainer(
		[`mkdir -p ${dir} && cat > ${dir}/patch.yml && cat > ${dir}/task.txt <<'POROS_TASK_EOF'\n${opts.task}\nPOROS_TASK_EOF`],
		patch,
		Math.min(timeoutMs, 30_000)
	);
	if (writeRes.code !== 0) throw new Error(`DSH 运行目录写入失败: ${(writeRes.stderr || '').slice(0, 300)}`);
	// 2) 真实执行：headless 单任务会话，NDJSON 事件到 stdout
	const keyEnv = stub ? 'POROS_MODEL_KEY=dummy ' : '';
	const runRes = await execContainer(
		[`cd ${dir} && ${keyEnv}dsh --patch ${dir}/patch.yml --profile headless --json - < ${dir}/task.txt; echo __POROS_EXIT__$?`],
		null,
		timeoutMs
	);
	const outLines = runRes.stdout.split('\n').filter((l) => l.trim());
	let exitTail = '';
	const events: DshEvent[] = [];
	for (const line of outLines) {
		if (line.startsWith('__POROS_EXIT__')) { exitTail = line; continue; }
		try { events.push(JSON.parse(line) as DshEvent); } catch { /* 非事件行（极少数诊断）→ 略 */ }
	}
	const exitCode = Number(exitTail.replace('__POROS_EXIT__', '')) || 0;
	const sessionEv = events.find((e) => e.type === 'session') as { sessionId?: string } | undefined;
	const finalEv = events.find((e) => e.type === 'final') as { text?: string; reason?: { kind?: string; error?: { message?: string } } } | undefined;
	const errorEv = events.find((e) => e.type === 'error') as { message?: string } | undefined;
	const completed = finalEv?.reason?.kind === 'completed';
	return {
		sessionId: sessionEv?.sessionId ?? null,
		final: finalEv?.text ?? '',
		completed,
		error: finalEv?.reason?.error?.message ?? errorEv?.message ?? (exitCode !== 0 ? `dsh 退出码 ${exitCode}` : null),
		events,
		diagnostics: (runRes.stderr || '').slice(-4000),
		modelChannel: stub ? 'stub' : 'container-env'
	};
}

/** 审查项③：事件流中的工具调用留痕 + 白名单审计。 */
export function auditToolCalls(events: DshEvent[], grants: DshGrant[]): Array<{ callId: string; tool: string; input: unknown; status: string; result: string; authorized: boolean }> {
	const allowed = grantedToolNames(grants);
	const results = new Map<string, { status: string; result: string }>();
	for (const e of events) {
		if (e.type === 'tool_result') {
			const r = e as { callId?: string; status?: string; result?: string };
			if (r.callId) results.set(r.callId, { status: String(r.status ?? ''), result: String(r.result ?? '').slice(0, 2000) });
		}
	}
	const calls: Array<{ callId: string; tool: string; input: unknown; status: string; result: string; authorized: boolean }> = [];
	for (const e of events) {
		if (e.type !== 'tool_call') continue;
		const c = e as { callId?: string; tool?: string; input?: unknown };
		const tool = String(c.tool ?? '');
		const st = results.get(String(c.callId ?? ''));
		calls.push({
			callId: String(c.callId ?? ''),
			tool,
			input: c.input,
			status: st?.status ?? 'no-result',
			result: st?.result ?? '',
			authorized: allowed.has(tool)
		});
	}
	return calls;
}
