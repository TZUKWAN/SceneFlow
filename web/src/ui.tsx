/**
 * 基础 UI 原语：全部组合自 Radix（无头可访问性）+ Tailwind（样式）。
 * 不自造可访问性/焦点管理——审查项⑦"复用成熟组件"的落地件。
 */
import * as DialogPrimitive from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'danger';
};

const VARIANTS: Record<string, string> = {
  primary: 'bg-[#c9694b] text-white hover:bg-[#b55a3f] disabled:bg-[#d8b7ab]',
  ghost: 'bg-white text-[#1f1f1e] border border-[#d9d7d2] hover:bg-[#efeeea] disabled:opacity-50',
  danger: 'bg-white text-[#a1301c] border border-[#e5c0b6] hover:bg-[#fbeae5]',
};

export function Button({ variant = 'primary', className = '', ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed ${VARIANTS[variant]} ${className}`}
    />
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className = '', ...rest } = props;
  return (
    <input
      {...rest}
      className={`w-full rounded-lg border border-[#d9d7d2] bg-white px-3 py-1.5 text-sm outline-none focus:border-[#c9694b] ${className}`}
    />
  );
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className = '', ...rest } = props;
  return (
    <textarea
      {...rest}
      className={`w-full rounded-lg border border-[#d9d7d2] bg-white px-3 py-2 text-sm outline-none focus:border-[#c9694b] ${className}`}
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const { className = '', ...rest } = props;
  return (
    <select
      {...rest}
      className={`rounded-lg border border-[#d9d7d2] bg-white px-2 py-1.5 text-sm outline-none focus:border-[#c9694b] ${className}`}
    />
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-[#e3e1dc] bg-white p-4 ${className}`}>{children}</div>;
}

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'ok' | 'warn' | 'bad' | 'brand'; children: ReactNode }) {
  const tones: Record<string, string> = {
    neutral: 'bg-[#efeeea] text-[#5c5a55]',
    ok: 'bg-[#e5f2e8] text-[#256b3a]',
    warn: 'bg-[#fdf3dd] text-[#8a5b12]',
    bad: 'bg-[#fbe5e0] text-[#a1301c]',
    brand: 'bg-[#f7e8e2] text-[#a14e33]',
  };
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

/** 状态 → 徽章色调（质量验收状态语义，审查项⑥）。 */
export function StatusBadge({ status }: { status: string }) {
  const tone =
    status === 'SUCCEEDED' ? 'ok' :
    status === 'SUCCEEDED_WITH_VIOLATIONS' ? 'bad' :
    status === 'UNVERIFIED' ? 'warn' :
    status === 'FAILED' || status === 'BLOCKED' ? 'bad' : 'neutral';
  const label =
    status === 'SUCCEEDED_WITH_VIOLATIONS' ? '成功·有违规' :
    status === 'UNVERIFIED' ? '未验证' : status;
  return <Badge tone={tone as 'ok' | 'bad' | 'warn' | 'neutral'}>{label}</Badge>;
}

/** Radix Dialog 封装（可访问性由 Radix 提供）。 */
export function Dialog({
  trigger,
  title,
  children,
  open,
  onOpenChange,
}: {
  trigger?: ReactNode;
  title: string;
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
}) {
  const controlled = open !== undefined;
  return (
    <DialogPrimitive.Root {...(controlled ? { open, onOpenChange } : {})}>
      {!controlled && trigger && <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger>}
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 bg-black/40 data-[state=open]:animate-in" />
        <DialogPrimitive.Content className="fixed left-1/2 top-1/2 max-h-[85vh] w-[min(680px,92vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
          <DialogPrimitive.Title className="mb-3 text-base font-semibold">{title}</DialogPrimitive.Title>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export const DialogClose = DialogPrimitive.Close;
