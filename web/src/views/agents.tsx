/** Agent 目录 + Builder（审查项②③：NL 构建、配置差异、能力授权、测试、发布/回滚）。 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { Badge, Button, Card, Dialog, DialogClose, Input, Select, StatusBadge, Textarea } from '../ui.js';

interface AgentRow {
  id: string;
  name: string;
  description: string;
  department: string;
  status: string;
  currentVersion: number;
  nlSource: string | null;
  draftConfig: Record<string, unknown>;
  grants: Array<{ kind: string; name: string; scopeNote: string }>;
}

export default function AgentsView({ role }: { role: string }) {
  const canBuild = role === 'BUILDER' || role === 'ADMIN';
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [nlOpen, setNlOpen] = useState(false);

  const refresh = useCallback(async () => {
    const r = await api<{ agents: AgentRow[] }>('GET', '/api/agents');
    if (r.ok) {
      setAgents(r.body.agents ?? []);
      if (!selected && r.body.agents?.length) setSelected(r.body.agents[0]!.id);
    }
  }, [selected]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const agent = agents.find((a) => a.id === selected);

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Agent 目录（{agents.length}）</span>
          {canBuild && (
            <Button onClick={() => setNlOpen(true)}>+ 自然语言创建</Button>
          )}
        </div>
        <div className="mt-3 grid gap-2">
          {agents.map((a) => (
            <button
              key={a.id}
              onClick={() => setSelected(a.id)}
              className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                a.id === selected ? 'border-[#c9694b] bg-[#fdf7f4]' : 'border-[#e3e1dc] bg-white hover:bg-[#faf9f7]'
              }`}
            >
              <span className="font-medium">{a.name}</span>
              <Badge tone={a.status === 'PUBLISHED' ? 'ok' : 'neutral'}>{a.status === 'PUBLISHED' ? `已发布 v${a.currentVersion}` : '草稿'}</Badge>
              {a.nlSource && <Badge tone="brand">NL</Badge>}
              <span className="truncate text-xs text-[#8a8880]">{a.description}</span>
            </button>
          ))}
          {!agents.length && <p className="text-sm text-[#a5a29b]">暂无 Agent{canBuild ? '，点击右上角创建' : ''}。</p>}
        </div>
      </Card>

      {agent && canBuild && <BuilderPanel agent={agent} onChanged={refresh} />}
      {nlOpen && <NlCreateDialog onClose={() => setNlOpen(false)} onCreated={(id) => { setNlOpen(false); setSelected(id); void refresh(); }} />}
    </div>
  );
}

/** 自然语言 → 结构化草稿（审查项②）：LLM 生成、nlSource 留痕、能力默认空（授权表管理）。 */
function NlCreateDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const create = async () => {
    setBusy(true);
    setError('');
    const r = await api<{ agent: { id: string } }>('POST', '/api/agents/drafts', { description });
    setBusy(false);
    if (!r.ok) setError(r.body.error ?? `HTTP ${r.status}`);
    else onCreated(r.body.agent.id);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="自然语言创建 Agent">
      <p className="mb-2 text-xs text-[#8a8880]">
        描述目标与边界；系统生成结构化草稿（人设/输出类型），能力默认为空，由授权表逐项批准。生成来源会留痕（nlSource）。
      </p>
      <Textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="例：创建一个能在容器内执行命令并汇报输出的运维检查 Agent" />
      {error && <p className="mt-2 text-sm text-[#a1301c]">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <DialogClose asChild>
          <Button variant="ghost">取消</Button>
        </DialogClose>
        <Button disabled={busy || description.trim().length < 4} onClick={create}>
          {busy ? '生成中…' : '生成草稿'}
        </Button>
      </div>
    </Dialog>
  );
}

const GRANT_KINDS = ['TOOL', 'SKILL', 'MCP', 'KNOWLEDGE', 'MODEL'] as const;
const TOOL_NAMES = ['bash', 'web.fetch', 'web.search'];

/** Builder 面板：配置差异 / 能力授权 / 草稿测试 / 发布 / 回滚（审查项②③全链路）。 */
function BuilderPanel({ agent, onChanged }: { agent: AgentRow; onChanged: () => void }) {
  const [grants, setGrants] = useState(agent.grants ?? []);
  const [grantKind, setGrantKind] = useState<(typeof GRANT_KINDS)[number]>('TOOL');
  const [grantName, setGrantName] = useState('bash');
  const [grantNote, setGrantNote] = useState('');
  const [testPrompt, setTestPrompt] = useState('');
  const [testResult, setTestResult] = useState<{ status: string; runtime: string; taskId: string } | null>(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  return (
    <Card>
      <div className="mb-3 flex items-center gap-2">
        <span className="text-sm font-medium">Builder · {agent.name}</span>
        <Badge tone={agent.status === 'PUBLISHED' ? 'ok' : 'neutral'}>{agent.status}</Badge>
        {agent.nlSource && <Badge tone="brand">NL 构建来源已留痕</Badge>}
      </div>

      {/* 配置（草稿）——NL 生成的 persona 等结构化字段直接可见 */}
      <div className="rounded-lg bg-[#faf9f7] p-3 text-xs">
        <p className="mb-1 font-medium text-[#5c5a55]">草稿配置（当前 diff 基线）</p>
        <pre className="overflow-x-auto whitespace-pre-wrap break-all text-[#1f1f1e]">{JSON.stringify(agent.draftConfig, null, 2)}</pre>
        <p className="mt-1 text-[#8a8880]">描述：{agent.description}</p>
      </div>

      {/* 能力授权（审查项③：默认拒绝，逐项批准 + scopeNote） */}
      <div className="mt-4">
        <p className="mb-1 text-sm font-medium">能力授权（未授权 = DSH 装载时禁用；事件层二次白名单审计）</p>
        <div className="mb-2 flex flex-wrap gap-2">
          {grants.map((g, i) => (
            <Badge key={`${g.kind}-${g.name}-${i}`} tone="brand">
              {g.kind}:{g.name}
            </Badge>
          ))}
          {!grants.length && <span className="text-xs text-[#a5a29b]">未授予任何能力（Agent 只能对话）。</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={grantKind} onChange={(e) => setGrantKind(e.target.value as (typeof GRANT_KINDS)[number])}>
            {GRANT_KINDS.map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </Select>
          {grantKind === 'TOOL' ? (
            <Select value={grantName} onChange={(e) => setGrantName(e.target.value)}>
              {TOOL_NAMES.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </Select>
          ) : (
            <Input className="w-40" value={grantName} onChange={(e) => setGrantName(e.target.value)} placeholder="能力名" />
          )}
          <Input className="w-56" value={grantNote} onChange={(e) => setGrantNote(e.target.value)} placeholder="授权范围说明（必填留痕）" />
          <Button
            variant="ghost"
            disabled={busy === 'grant' || (grantKind !== 'TOOL' && !grantName.trim()) || !grantNote.trim()}
            onClick={async () => {
              setBusy('grant');
              const r = await api(`POST`, `/api/agents/${agent.id}/grants`, { kind: grantKind, name: grantName, scopeNote: grantNote });
              setBusy('');
              if (r.ok) {
                setMsg({ tone: 'ok', text: `已授权 ${grantKind}:${grantName}` });
                setGrantNote('');
                const fresh = await api<{ agents: AgentRow[] }>('GET', '/api/agents');
                const me = fresh.ok ? (fresh.body.agents ?? []).find((a) => a.id === agent.id) : undefined;
                if (me) setGrants(me.grants ?? []);
                onChanged();
              } else setMsg({ tone: 'bad', text: r.body.error ?? `HTTP ${r.status}` });
            }}
          >
            授权
          </Button>
        </div>
      </div>

      {/* 草稿测试 + 发布/回滚 */}
      <div className="mt-4 flex flex-wrap items-start gap-2">
        <Textarea rows={2} className="w-full sm:w-96" value={testPrompt} onChange={(e) => setTestPrompt(e.target.value)} placeholder="草稿测试提示词（真实执行，不产生版本）" />
        <Button
          variant="ghost"
          disabled={busy === 'test' || !testPrompt.trim()}
          onClick={async () => {
            setBusy('test');
            const r = await api<{ run: { status: string }; runtime: string; taskId: string }>('POST', `/api/agents/${agent.id}/test-runs`, { prompt: testPrompt });
            setBusy('');
            if (r.ok) setTestResult({ status: r.body.run.status, runtime: r.body.runtime, taskId: r.body.taskId });
            else setMsg({ tone: 'bad', text: r.body.error ?? `HTTP ${r.status}` });
          }}
        >
          {busy === 'test' ? '测试中…' : '草稿测试'}
        </Button>
        {testResult && (
          <span className="flex items-center gap-1 text-xs text-[#8a8880]">
            <Badge tone="brand">{testResult.runtime}</Badge>
            <StatusBadge status={testResult.status} />
          </span>
        )}
        <div className="ml-auto flex gap-2">
          <Button
            disabled={busy === 'publish'}
            onClick={async () => {
              setBusy('publish');
              const r = await api<{ version: number }>('POST', `/api/agents/${agent.id}/publish`);
              setBusy('');
              setMsg(r.ok ? { tone: 'ok', text: `已发布 v${r.body.version}（不可变快照）` } : { tone: 'bad', text: r.body.error ?? `HTTP ${r.status}` });
              onChanged();
            }}
          >
            {busy === 'publish' ? '发布中…' : '发布版本'}
          </Button>
          {agent.currentVersion > 1 && (
            <Button
              variant="ghost"
              disabled={busy === 'rollback'}
              onClick={async () => {
                setBusy('rollback');
                const r = await api('POST', `/api/agents/${agent.id}/rollback`, { version: agent.currentVersion - 1 });
                setBusy('');
                setMsg(r.ok ? { tone: 'ok', text: `已回滚到 v${agent.currentVersion - 1}` } : { tone: 'bad', text: r.body.error ?? `HTTP ${r.status}` });
                onChanged();
              }}
            >
              回滚上一版
            </Button>
          )}
        </div>
      </div>

      {msg && <p className={`mt-3 text-sm ${msg.tone === 'ok' ? 'text-[#256b3a]' : 'text-[#a1301c]'}`}>{msg.text}</p>}
    </Card>
  );
}
