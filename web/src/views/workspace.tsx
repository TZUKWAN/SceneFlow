/** 工作台：统一任务入口 + 运行事件实时流（真实执行证据可见：dsh.* 事件、Judgment 注入/评估）。 */
import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { Badge, Button, Card, Select, StatusBadge, Textarea } from '../ui.js';

interface AgentRow {
  id: string;
  name: string;
  description: string;
  status: string;
  currentVersion: number;
}

interface RunResult {
  runId: string;
  status: string;
}

export default function WorkspaceView({ role }: { role: string }) {
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [agentId, setAgentId] = useState('');
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [last, setLast] = useState<{ taskId: string; run: RunResult; runtime: string } | null>(null);
  const canRun = role === 'EMPLOYEE' || role === 'BUILDER' || role === 'REVIEWER' || role === 'ADMIN';

  useEffect(() => {
    api<{ agents: AgentRow[] }>('GET', '/api/agents').then((r) => {
      if (r.ok) {
        setAgents(r.body.agents ?? []);
        const first = (r.body.agents ?? []).find((a) => a.status === 'PUBLISHED');
        if (first) setAgentId(first.id);
      }
    });
  }, []);

  const submit = async () => {
    setBusy(true);
    setError('');
    const r = await api<{ taskId: string; run: RunResult; runtime: string }>('POST', '/api/tasks', {
      agentId,
      prompt,
    });
    setBusy(false);
    if (!r.ok) {
      setError(r.body.error ?? `HTTP ${r.status}`);
      return;
    }
    setLast({ taskId: r.body.taskId, run: r.body.run, runtime: r.body.runtime });
  };

  return (
    <div className="space-y-4">
      <Card>
        <div className="mb-3 flex items-center gap-2">
          <span className="text-sm font-medium">下达任务</span>
          {last && (
            <span className="ml-auto flex items-center gap-2 text-xs text-[#8a8880]">
              执行通道 <Badge tone="brand">{last.runtime}</Badge>
              <StatusBadge status={last.run.status} />
            </span>
          )}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Select value={agentId} onChange={(e) => setAgentId(e.target.value)} className="sm:w-64">
            <option value="">选择已发布 Agent…</option>
            {agents
              .filter((a) => a.status === 'PUBLISHED')
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} (v{a.currentVersion})
                </option>
              ))}
          </Select>
          <Button disabled={!canRun || !agentId || busy || !prompt.trim()} onClick={submit}>
            {busy ? '执行中…' : '运行'}
          </Button>
        </div>
        <Textarea
          rows={3}
          className="mt-2"
          placeholder="用自然语言描述任务…"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        {error && <p className="mt-2 text-sm text-[#a1301c]">{error}</p>}
        {!canRun && <p className="mt-2 text-xs text-[#8a8880]">当前角色无运行权限。</p>}
      </Card>
      {last && <RunEvents key={last.taskId} taskId={last.taskId} />}
    </div>
  );
}

interface EventRow {
  seq: number;
  kind: string;
  payload: Record<string, unknown>;
}

/** SSE 事件流（先到先回放 + done 终止；事件由真实运行产生落库，非历史回放冒充）。 */
function RunEvents({ taskId }: { taskId: string }) {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [done, setDone] = useState(false);
  const seen = useRef(new Set<number>());

  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`/api/tasks/${taskId}/events`, {
      headers: { authorization: `Bearer ${localStorage.getItem('poros-token')}` },
      signal: ctrl.signal,
    })
      .then(async (res) => {
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        for (;;) {
          const { done: d, value } = await reader.read();
          if (d) break;
          buf += decoder.decode(value, { stream: true });
          const parts = buf.split('\n\n');
          buf = parts.pop()!;
          for (const part of parts) {
            const evLine = part.split('\n').find((l) => l.startsWith('event: '));
            const dataLine = part.split('\n').find((l) => l.startsWith('data: '));
            if (!evLine || !dataLine) continue;
            const kind = evLine.slice(7);
            if (kind === 'done') {
              setDone(true);
              continue;
            }
            try {
              const { seq, payload } = JSON.parse(dataLine.slice(6)) as EventRow;
              if (!seen.current.has(seq)) {
                seen.current.add(seq);
                setEvents((prev) => [...prev, { seq, kind, payload }]);
              }
            } catch {
              /* 忽略坏帧 */
            }
          }
        }
      })
      .catch(() => setDone(true));
    return () => ctrl.abort();
  }, [taskId]);

  return (
    <Card>
      <div className="mb-2 flex items-center gap-2">
        <span className="text-sm font-medium">运行事件</span>
        {done && <Badge tone="ok">已结束</Badge>}
        <span className="text-xs text-[#a5a29b]">真实执行证据逐条落库（dsh.* = 容器内 DSH 事件；judge = 语义裁决留痕）</span>
      </div>
      <div className="max-h-80 space-y-1 overflow-y-auto font-mono text-xs">
        {events.map((e) => (
          <EventLine key={e.seq} kind={e.kind} payload={e.payload} />
        ))}
        {!events.length && <p className="text-[#a5a29b]">等待事件…</p>}
      </div>
    </Card>
  );
}

function EventLine({ kind, payload }: { kind: string; payload: Record<string, unknown> }) {
  const tone =
    kind.startsWith('dsh.tool_call') ? 'brand' :
    kind.startsWith('dsh.tool_result') ? 'neutral' :
    kind === 'security.audit' ? 'bad' :
    kind === 'status' ? 'ok' : 'neutral';
  return (
    <div className="flex gap-2 rounded bg-[#faf9f7] px-2 py-1">
      <span className="shrink-0 text-[#a5a29b]">#{String(payload.seq ?? '')}</span>
      <Badge tone={tone as 'brand' | 'neutral' | 'bad' | 'ok'}>{kind}</Badge>
      <span className="truncate text-[#5c5a55]" title={JSON.stringify(payload)}>
        {summarize(kind, payload)}
      </span>
    </div>
  );
}

function summarize(kind: string, payload: Record<string, unknown>): string {
  if (kind === 'judgment' && payload.phase === 'inject') {
    const rules = (payload.rules as Array<{ ruleId: string; version: number }>) ?? [];
    return `注入 ${rules.length} 条已批准规则（${rules.map((r) => `${r.ruleId}@v${r.version}`).join(', ') || '无'}）`;
  }
  if (kind === 'judgment' && payload.phase === 'evaluate') {
    return `评估 ${String(payload.ruleId)} → ${String(payload.evaluation)}${payload.reason ? `（${String(payload.reason)}）` : ''}`;
  }
  if (kind === 'dsh.tool_call') {
    const input = (payload.input as { command?: string }) ?? {};
    return `工具 ${String(payload.tool)}：${input.command ?? JSON.stringify(payload.input ?? {})}`;
  }
  if (kind === 'dsh.tool_result') {
    return `结果 ${String(payload.status)}：${String(payload.result ?? '').slice(0, 80)}`;
  }
  if (kind === 'status') return `终态 ${String(payload.status)}（runtime ${String(payload.runtime ?? '')}）`;
  if (kind === 'judge') return `语义 Judge：${String(payload.modelCalls)} 次模型调用（成本留痕）`;
  return JSON.stringify(payload).slice(0, 120);
}
