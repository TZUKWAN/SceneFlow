/** API 客户端：JWT 走 Authorization 头（审查项④：Token 不进 URL）。 */
let token: string | null = localStorage.getItem('poros-token');

export function getToken(): string | null {
  return token;
}

export function setToken(t: string | null): void {
  token = t;
  if (t) localStorage.setItem('poros-token', t);
  else localStorage.removeItem('poros-token');
}

export interface ApiResult<T = Record<string, unknown>> {
  ok: boolean;
  status: number;
  body: T & { error?: string };
}

export async function api<T = Record<string, unknown>>(
  method: string,
  path: string,
  body?: unknown
): Promise<ApiResult<T>> {
  const res = await fetch(path, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json: Record<string, unknown> = {};
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    /* 非 JSON（如 SSE） */
  }
  return { ok: res.ok, status: res.status, body: json as T & { error?: string } };
}

export interface OrgInfo {
  organizationId: string;
  role: string;
  email: string;
  exp?: number;
}

/** 登录并记住身份（组织=org-a 为当前部署主组织；多组织切换在 Organization 页迭代）。 */
export async function login(
  email: string,
  password: string,
  organizationId: string
): Promise<{ ok: boolean; error?: string; info?: OrgInfo }> {
  const r = await api<{ token?: string }>('POST', '/api/auth/login', {
    email,
    password,
    organizationId,
  });
  if (!r.ok || !r.body.token) return { ok: false, error: r.body.error ?? `HTTP ${r.status}` };
  setToken(r.body.token);
  // 从令牌 payload 取身份（无需专用 /me 端点）
  try {
    const payload = JSON.parse(atob(r.body.token.split('.')[1]!)) as OrgInfo;
    return { ok: true, info: payload };
  } catch {
    return { ok: true };
  }
}

export function logout(): void {
  setToken(null);
}
