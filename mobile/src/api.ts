export type User = { id: string; name: string; email: string };
export type Device = {
  id: string; name: string; desiredEnabled: boolean; desiredVersion: number;
  reportedEnabled: boolean | null; reportedVersion: number | null;
  lastSeenAt: string | null; pending: boolean;
};
export type StudyEvent = {
  id: string; eventId: string; time: string; userId: string; deviceId: string;
  eventType: string; payload: Record<string, unknown>;
};
export type EventPage = { events: StudyEvent[]; nextCursor: string | null };
export const API_URL = (process.env.EXPO_PUBLIC_API_URL || '').replace(/\/+$/, '');
export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export async function request<T>(path: string, token?: string, body?: unknown): Promise<T> {
  if (!/^https:\/\/[^/]+/.test(API_URL) && !(__DEV__ && /^http:\/\/[^/]+/.test(API_URL)))
    throw new Error('Configure EXPO_PUBLIC_API_URL em mobile/.env com o endereço HTTPS da API.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(`${API_URL}/api/v1${path}`, {
      method: body === undefined ? 'GET' : 'POST', signal: controller.signal,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const data = response.status === 204 ? undefined : await response.json();
    if (!response.ok) throw new ApiError(data?.error || 'Falha na comunicação.', response.status);
    return data as T;
  } finally { clearTimeout(timer); }
}
export const streamUrl = () => `${API_URL.replace(/^http/, 'ws')}/api/v1/stream`;
