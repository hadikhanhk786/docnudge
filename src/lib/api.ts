import { useAuth } from '@clerk/clerk-react';
import { useMemo } from 'react';

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

/** Authenticated calls to /api/app/*. Sends the Clerk session token as a Bearer header. */
export function useApi() {
  const { getToken } = useAuth();
  return useMemo(() => {
    async function raw(method: string, path: string, body?: unknown): Promise<Response> {
      const token = await getToken();
      return fetch(`/api/app${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    }
    async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
      const res = await raw(method, path, body);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? 'error');
      return data as T;
    }
    return {
      get: <T,>(path: string) => call<T>('GET', path),
      post: <T,>(path: string, body?: unknown) => call<T>('POST', path, body ?? {}),
      put: <T,>(path: string, body: unknown) => call<T>('PUT', path, body),
      patch: <T,>(path: string, body: unknown) => call<T>('PATCH', path, body),
      /** Downloads need the auth header, so fetch a blob and click a temporary link. */
      async download(path: string, filename: string) {
        const res = await raw('GET', path);
        if (!res.ok) throw new ApiError(res.status, 'download_failed');
        const url = URL.createObjectURL(await res.blob());
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      },
    };
  }, [getToken]);
}
