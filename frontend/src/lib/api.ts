const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const TOKEN_KEY = "erp.token";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (typeof window === "undefined") return;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
}

/** FastAPI puts validation failures in `detail`, which is either a string or a
 *  list of per-field errors. Flatten both into one readable Arabic-safe line. */
function readDetail(body: unknown, fallback: string): string {
  if (typeof body !== "object" || body === null) return fallback;
  const detail = (body as { detail?: unknown }).detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (typeof item !== "object" || item === null) return String(item);
        const err = item as { loc?: unknown[]; msg?: string };
        const field = Array.isArray(err.loc) ? err.loc.slice(1).join(".") : "";
        return field ? `${field}: ${err.msg}` : (err.msg ?? "");
      })
      .filter(Boolean)
      .join("، ");
  }
  return fallback;
}

type Query = Record<string, string | number | boolean | null | undefined>;

function withQuery(path: string, query?: Query): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== null && value !== undefined && value !== "") {
      params.set(key, String(value));
    }
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, { ...init, headers });
  } catch {
    throw new ApiError(0, "تعذّر الاتصال بالخادم");
  }

  if (response.status === 401) {
    setToken(null);
    if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
      window.location.href = "/login";
    }
    throw new ApiError(401, "انتهت الجلسة — يرجى تسجيل الدخول من جديد");
  }

  if (response.status === 204) return undefined as T;

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(response.status, readDetail(body, `خطأ ${response.status}`));
  }
  return body as T;
}

export const api = {
  get: <T>(path: string, query?: Query) => request<T>(withQuery(path, query)),
  post: <T>(path: string, body?: unknown, query?: Query) =>
    request<T>(withQuery(path, query), {
      method: "POST",
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),

  /** Save a file the API serves behind the token (a backup). A plain link
   *  cannot send the Authorization header, so fetch it and hand the browser
   *  the bytes. */
  async download(path: string, filename: string): Promise<void> {
    const token = getToken();
    let response: Response;
    try {
      response = await fetch(`${BASE}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    } catch {
      throw new ApiError(0, "تعذّر الاتصال بالخادم");
    }
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new ApiError(response.status, readDetail(body, `خطأ ${response.status}`));
    }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  },

  /** Login is the one endpoint that takes form-encoded data (OAuth2 password flow). */
  async login(username: string, password: string): Promise<string> {
    const body = new URLSearchParams({ username, password });
    let response: Response;
    try {
      response = await fetch(`${BASE}/api/auth/login`, { method: "POST", body });
    } catch {
      throw new ApiError(0, "تعذّر الاتصال بالخادم");
    }
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      throw new ApiError(response.status, readDetail(data, "فشل تسجيل الدخول"));
    }
    const token = (data as { access_token: string }).access_token;
    setToken(token);
    return token;
  },
};
