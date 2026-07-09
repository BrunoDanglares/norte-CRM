import { QueryClient, QueryFunction } from "@tanstack/react-query";

function getAuthHeaders(extraHeaders?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...extraHeaders };
  const token = localStorage.getItem("flowcrm_token");
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return headers;
}

function handle401() {
  localStorage.removeItem("flowcrm_token");
  localStorage.removeItem("flowcrm_user");
  if (window.location.pathname !== "/login") {
    window.location.href = "/login";
  }
}

// 402 = assinatura pendente. Diferente do 401: NÃO desloga — manda pro paywall
// (/assinatura) mantendo a sessão, pro cliente regularizar o pagamento.
function handle402() {
  if (window.location.pathname !== "/assinatura") {
    window.location.href = "/assinatura";
  }
}

async function throwIfResNotOk(res: Response) {
  if (res.status === 401) {
    handle401();
    throw new Error("Sessao expirada");
  }
  if (res.status === 402) {
    handle402();
    throw new Error("Assinatura pendente");
  }
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiFetch(url: string, options?: RequestInit): Promise<any> {
  const res = await fetch(url, {
    ...options,
    credentials: "include",
    headers: getAuthHeaders(options?.headers as Record<string, string>),
  });
  await throwIfResNotOk(res);
  return res.json();
}

export async function apiUpload(url: string, formData: FormData): Promise<Response> {
  const res = await fetch(url, {
    method: "POST",
    headers: getAuthHeaders(),
    body: formData,
    credentials: "include",
  });
  await throwIfResNotOk(res);
  return res;
}

export async function apiFetchRaw(url: string, options?: RequestInit): Promise<Response> {
  const res = await fetch(url, {
    ...options,
    credentials: "include",
    headers: getAuthHeaders(options?.headers as Record<string, string>),
  });
  if (res.status === 401) {
    handle401();
    throw new Error("Sessao expirada");
  }
  if (res.status === 402) {
    handle402();
    throw new Error("Assinatura pendente");
  }
  return res;
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const headers: Record<string, string> = getAuthHeaders(
    data ? { "Content-Type": "application/json" } : {}
  );

  const res = await fetch(url, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
      headers: getAuthHeaders(),
    });

    if (res.status === 401) {
      if (unauthorizedBehavior === "returnNull") {
        return null;
      }
      handle401();
      throw new Error("Sessao expirada");
    }
    if (res.status === 402) {
      handle402();
      throw new Error("Assinatura pendente");
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: 2 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
