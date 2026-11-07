// Cliente mínimo do PostgREST: guarda o token de login e fala com a API via fetch.

const tokenKey = 'wiki-session';

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.message || `Erro ${status} na API.`);
    this.status = status;
    this.code = body?.code;
  }
}

export function createApi(baseUrl, { onUnauthorized } = {}) {
  const base = baseUrl.replace(/\/+$/, '');

  function readSession() {
    try {
      const session = JSON.parse(localStorage.getItem(tokenKey));
      return session?.token && session.expires_at * 1000 > Date.now() ? session : null;
    } catch {
      return null;
    }
  }

  let session = readSession();

  function saveSession(value) {
    session = value;
    try {
      if (value) localStorage.setItem(tokenKey, JSON.stringify(value));
      else localStorage.removeItem(tokenKey);
    } catch { /* sem armazenamento: a sessão dura só esta aba */ }
  }

  // path: "notes?select=id" ou "rpc/login". Devolve o JSON da resposta (ou null).
  async function request(method, path, { body, prefer } = {}) {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (prefer) headers.Prefer = prefer;
    if (session) headers.Authorization = `Bearer ${session.token}`;
    const response = await fetch(`${base}/${path}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) {
      if (response.status === 401 && session) {
        saveSession(null);
        onUnauthorized?.();
      }
      throw new ApiError(response.status, data);
    }
    return data;
  }

  return {
    get session() { return session; },

    async login(email, password) {
      session = null;
      saveSession(await request('POST', 'rpc/login', { body: { email, password } }));
    },
    logout() { saveSession(null); },

    get: (path) => request('GET', path),
    // Devolve a primeira linha ou null.
    one: async (path) => (await request('GET', path))[0] ?? null,
    insert: (table, row, prefer = 'return=representation') => request('POST', table, { body: row, prefer }),
    update: (path, values) => request('PATCH', path, { body: values, prefer: 'return=minimal' }),
    remove: (path) => request('DELETE', path, { prefer: 'return=minimal' }),
    rpc: (name, args = {}) => request('POST', `rpc/${name}`, { body: args }),

    fileUrl(query, download = false) {
      return `${base}/rpc/file?${query}${download ? '&download=true' : ''}`;
    },
  };
}

// Filtro de igualdade do PostgREST com o valor escapado.
export function eq(value) {
  return `eq.${encodeURIComponent(value)}`;
}
