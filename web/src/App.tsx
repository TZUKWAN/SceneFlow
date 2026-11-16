import * as Tabs from '@radix-ui/react-tabs';
import { useState } from 'react';
import { getToken, login, logout, type OrgInfo } from './api.js';
import { Button, Input } from './ui.js';
import WorkspaceView from './views/workspace.js';
import AgentsView from './views/agents.js';
import IntegrationsView from './views/integrations.js';

export default function App() {
  const [auth, setAuth] = useState<OrgInfo | null>(getToken() ? parseJwt(getToken()!) : null);

  if (!auth) return <LoginView onLogin={setAuth} />;

  return (
    <div className="mx-auto min-h-screen max-w-5xl px-4 pb-10">
      <header className="flex items-center justify-between py-4">
        <div>
          <h1 className="text-lg font-bold">Poros 工作台</h1>
          <p className="text-xs text-[#8a8880]">
            {auth.email} · 角色 {auth.role}
          </p>
        </div>
        <Button
          variant="ghost"
          onClick={() => {
            logout();
            setAuth(null);
          }}
        >
          退出
        </Button>
      </header>
      <Tabs.Root defaultValue="workspace">
        <Tabs.List className="mb-4 flex gap-1 border-b border-[#e3e1dc]">
          {[
            ['workspace', '工作台'],
            ['agents', 'Agent 目录 / Builder'],
            ['integrations', '集成与状态'],
          ].map(([value, label]) => (
            <Tabs.Trigger
              key={value}
              value={value!}
              className="rounded-t-lg px-4 py-2 text-sm text-[#8a8880] hover:text-[#1f1f1e] data-[state=active]:border-b-2 data-[state=active]:border-[#c9694b] data-[state=active]:font-medium data-[state=active]:text-[#1f1f1e]"
            >
              {label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <Tabs.Content value="workspace">
          <WorkspaceView role={auth.role} />
        </Tabs.Content>
        <Tabs.Content value="agents">
          <AgentsView role={auth.role} />
        </Tabs.Content>
        <Tabs.Content value="integrations">
          <IntegrationsView />
        </Tabs.Content>
      </Tabs.Root>
      <footer className="mt-8 text-center text-xs text-[#a5a29b]">
        唯一 Agent Harness：DSH（专属容器，宿主零接触）· 质量状态含 FAIL/UNCHECKED 语义 · 未配置的集成如实标注
      </footer>
    </div>
  );
}

function parseJwt(token: string): OrgInfo | null {
  try {
    const p = JSON.parse(atob(token.split('.')[1]!)) as OrgInfo;
    if (typeof p.exp === 'number' && p.exp * 1000 < Date.now()) return null;
    return { organizationId: String(p.organizationId), role: String(p.role), email: String(p.email) };
  } catch {
    return null;
  }
}

function LoginView({ onLogin }: { onLogin: (info: OrgInfo) => void }) {
  const [email, setEmail] = useState('employee@a.test');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError('');
    const r = await login(email, password, 'org-a');
    setBusy(false);
    if (!r.ok || !r.info) setError(r.error ?? '登录失败');
    else onLogin(r.info);
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-bold">Poros</h1>
        <p className="mt-1 text-sm text-[#8a8880]">企业 Agent 开发、配置、协作与治理平台</p>
      </div>
      <div className="space-y-3 rounded-2xl border border-[#e3e1dc] bg-white p-5">
        <label className="block text-sm font-medium">邮箱</label>
        <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="employee@a.test" />
        <label className="block text-sm font-medium">密码</label>
        <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} placeholder="开发/CI 种子密码见 .env 或 seed.ts" />
        {error && <p className="text-sm text-[#a1301c]">{error}</p>}
        <Button className="w-full justify-center" disabled={busy || !password} onClick={submit}>
          {busy ? '登录中…' : '登录'}
        </Button>
        <p className="text-xs text-[#a5a29b]">
          种子账号：admin / builder / employee / reviewer @a.test（密码 &lt;名&gt;-pass-123）。生产环境接组织 IdP。
        </p>
      </div>
    </div>
  );
}
