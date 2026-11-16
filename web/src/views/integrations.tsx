/** 集成与状态（凭证门控项固化：未配置的集成如实标注，不虚报可用）。 */
import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Badge, Card } from '../ui.js';

interface StatusBody {
  modelGateway: string;
  modelDisclaimer: string;
  kdocs: string;
  ima: string;
  tinyfish: string;
}

export default function IntegrationsView() {
  const [s, setS] = useState<StatusBody | null>(null);
  useEffect(() => {
    api<StatusBody>('GET', '/api/integrations/status').then((r) => {
      if (r.ok) setS(r.body as unknown as StatusBody);
    });
  }, []);

  return (
    <div className="space-y-4">
      <Card>
        <p className="mb-3 text-sm font-medium">执行与模型通道</p>
        {s && (
          <div className="grid gap-2 text-sm">
            <Row label="Agent Harness" value={<Badge tone="ok">DSH 专属容器（宿主零接触）</Badge>} />
            <Row
              label="模型网关"
              value={
                s.modelGateway === 'mock' ? (
                  <Badge tone="warn">mock（未配置真实模型服务）</Badge>
                ) : (
                  <Badge tone="ok">{s.modelGateway}</Badge>
                )
              }
            />
            <Row
              label="语义 Judge"
              value={s.modelGateway === 'deepseek' ? <Badge tone="ok">随模型网关接入（fail-open UNCHECKED）</Badge> : <Badge tone="warn">未配置 → 语义规则记 UNCHECKED</Badge>}
            />
          </div>
        )}
      </Card>
      <Card>
        <p className="mb-3 text-sm font-medium">办公 / 知识 / 检索集成</p>
        {s && (
          <div className="grid gap-2 text-sm">
            <Row label="Kdocs" value={<Badge tone="warn">{s.kdocs}</Badge>} />
            <Row label="IMA" value={<Badge tone="warn">{s.ima}</Badge>} />
            <Row label="TinyFish Search/Fetch" value={<Badge tone="warn">{s.tinyfish}</Badge>} />
          </div>
        )}
        <p className="mt-3 text-xs text-[#a5a29b]">
          以上集成需要组织级凭证（Kdocs/IMA/TinyFish API key）。无凭证时仅跑 mock 契约测试并在 UI 标注「未配置/未验证真实服务」——不冒充可用（PRD §6.3）。
        </p>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-[#faf9f7] px-3 py-2">
      <span className="text-[#5c5a55]">{label}</span>
      {value}
    </div>
  );
}
