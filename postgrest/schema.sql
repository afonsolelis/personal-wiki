-- Esquema da Personal Wiki no Postgres + PostgREST da VPS (Coolify). Pode rodar mais de uma vez.
--
--   docker exec -i postgres-<uuid> psql -U postgres -d wiki -v ON_ERROR_STOP=1 \
--     -v auth_password=... -v jwt_secret=... < postgrest/schema.sql
--
-- Papéis:
--   anon          sem login: só pode chamar login() e file() (com link assinado).
--   wiki_owner    quem tem o token de login(): lê e grava tudo.
--   authenticator usuário do PostgREST; troca para um dos dois acima a cada pedido.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wiki_owner') THEN CREATE ROLE wiki_owner NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN
    CREATE ROLE authenticator LOGIN NOINHERIT;
  END IF;
END $$;
ALTER ROLE authenticator PASSWORD :'auth_password';
GRANT anon, wiki_owner TO authenticator;

-- ---------- área privada (fora da API) ----------

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;

CREATE TABLE IF NOT EXISTS private.settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- O mesmo segredo do PGRST_JWT_SECRET: assina os tokens de login e os links dos arquivos.
INSERT INTO private.settings VALUES ('jwt_secret', :'jwt_secret')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- Dono do acervo. password_hash é bcrypt (veio do Supabase Auth; crypt() confere).
CREATE TABLE IF NOT EXISTS private.owner (
  email TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS private.login_failures (
  at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION private.secret() RETURNS TEXT
LANGUAGE sql STABLE AS $$ SELECT value FROM private.settings WHERE key = 'jwt_secret' $$;

CREATE OR REPLACE FUNCTION private.b64url(data BYTEA) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT translate(rtrim(replace(encode(data, 'base64'), E'\n', ''), '='), '+/', '-_');
$$;

-- Codifica o nome do arquivo para o Content-Disposition (filename*=UTF-8''...).
CREATE OR REPLACE FUNCTION private.url_encode(value TEXT) RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  bytes BYTEA := convert_to(value, 'UTF8');
  result TEXT := '';
  b INTEGER;
BEGIN
  FOR i IN 0..length(bytes) - 1 LOOP
    b := get_byte(bytes, i);
    IF chr(b) ~ '[A-Za-z0-9._~-]' AND b < 128 THEN result := result || chr(b);
    ELSE result := result || '%' || upper(lpad(to_hex(b), 2, '0'));
    END IF;
  END LOOP;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION private.file_signature(id UUID, exp BIGINT) RETURNS TEXT
LANGUAGE sql STABLE AS $$
  SELECT encode(hmac(id::TEXT || ':' || exp::TEXT, private.secret(), 'sha256'), 'hex');
$$;

-- ---------- tabelas ----------

CREATE TABLE IF NOT EXISTS public.notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(180) NOT NULL,
  category VARCHAR(80) NOT NULL DEFAULT 'Geral',
  content TEXT NOT NULL DEFAULT '',
  is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
  position INTEGER,
  source_path TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Metadados do arquivo; os bytes ficam em private.document_files.
CREATE TABLE IF NOT EXISTS public.documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(180) NOT NULL,
  category VARCHAR(80) NOT NULL DEFAULT 'Documentos',
  description TEXT NOT NULL DEFAULT '',
  original_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(160) NOT NULL,
  file_size BIGINT NOT NULL CHECK (file_size >= 0),
  note_id UUID REFERENCES public.notes(id) ON DELETE SET NULL,
  source_path TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Apagar o documento apaga o arquivo junto.
CREATE TABLE IF NOT EXISTS private.document_files (
  document_id UUID PRIMARY KEY REFERENCES public.documents(id) ON DELETE CASCADE,
  data BYTEA NOT NULL
);

CREATE TABLE IF NOT EXISTS public.bills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(120) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Um registro por conta marcada no mês; zerar o mês apaga os registros dele.
CREATE TABLE IF NOT EXISTS public.bill_payments (
  bill_id UUID NOT NULL REFERENCES public.bills(id) ON DELETE CASCADE,
  month DATE NOT NULL,
  paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (bill_id, month)
);

CREATE INDEX IF NOT EXISTS idx_notes_position ON public.notes (position);
CREATE INDEX IF NOT EXISTS idx_documents_updated_at ON public.documents (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_note_id ON public.documents (note_id);

-- Página nova entra no topo da lista.
CREATE OR REPLACE FUNCTION public.notes_default_position() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.position IS NULL THEN
    SELECT COALESCE(MIN(position), 1) - 1 INTO NEW.position FROM notes;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notes_default_position ON public.notes;
CREATE TRIGGER notes_default_position BEFORE INSERT ON public.notes
  FOR EACH ROW EXECUTE FUNCTION public.notes_default_position();

-- ---------- funções da API ----------

-- POST /rpc/login {email, password} → {token, expires_at}. Token vale 30 dias.
-- Erros devolvem status 401/429 sem exceção, para o registro da falha não ser desfeito.
CREATE OR REPLACE FUNCTION public.login(email TEXT, password TEXT) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = private, public AS $$
DECLARE
  hash TEXT;
  exp BIGINT := extract(epoch FROM NOW() + INTERVAL '30 days')::BIGINT;
  header TEXT := private.b64url(convert_to('{"alg":"HS256","typ":"JWT"}', 'UTF8'));
  payload TEXT;
BEGIN
  DELETE FROM login_failures WHERE at < NOW() - INTERVAL '1 day';
  IF (SELECT COUNT(*) FROM login_failures WHERE at > NOW() - INTERVAL '15 minutes') >= 10 THEN
    PERFORM set_config('response.status', '429', TRUE);
    RETURN json_build_object('message', 'Muitas tentativas. Aguarde alguns minutos.');
  END IF;

  SELECT o.password_hash INTO hash FROM owner o WHERE o.email = lower(login.email);
  IF hash IS NULL OR crypt(login.password, hash) <> hash THEN
    INSERT INTO login_failures DEFAULT VALUES;
    PERFORM set_config('response.status', '401', TRUE);
    RETURN json_build_object('message', 'Senha incorreta.');
  END IF;

  payload := private.b64url(convert_to(json_build_object(
    'role', 'wiki_owner', 'email', lower(login.email), 'exp', exp)::TEXT, 'UTF8'));
  RETURN json_build_object(
    'token', header || '.' || payload || '.' ||
      private.b64url(hmac(header || '.' || payload, private.secret(), 'sha256')),
    'expires_at', exp);
END;
$$;

-- Troca a senha (mínimo de 8 caracteres): POST /rpc/change_password com o token.
CREATE OR REPLACE FUNCTION public.change_password(current_password TEXT, new_password TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = private, public AS $$
DECLARE
  who TEXT := current_setting('request.jwt.claims', TRUE)::JSON ->> 'email';
  hash TEXT;
BEGIN
  SELECT o.password_hash INTO hash FROM owner o WHERE o.email = who;
  IF hash IS NULL OR crypt(current_password, hash) <> hash THEN RAISE EXCEPTION 'Senha atual incorreta.'; END IF;
  IF length(new_password) < 8 THEN RAISE EXCEPTION 'A nova senha precisa de pelo menos 8 caracteres.'; END IF;
  UPDATE owner SET password_hash = crypt(new_password, gen_salt('bf', 10)) WHERE email = who;
END;
$$;

-- Grava metadados e arquivo juntos (o arquivo chega em base64).
CREATE OR REPLACE FUNCTION public.create_document(document JSON, data TEXT) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = private, public AS $$
DECLARE
  bytes BYTEA;
  new_id UUID;
BEGIN
  BEGIN
    bytes := decode(data, 'base64');
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'O arquivo chegou corrompido. Envie de novo.';
  END;
  IF length(bytes) > 10 * 1024 * 1024 THEN RAISE EXCEPTION 'O arquivo passa de 10 MB.'; END IF;

  INSERT INTO public.documents (id, title, category, description, original_name, mime_type, file_size, note_id)
  VALUES (
    COALESCE((document ->> 'id')::UUID, gen_random_uuid()),
    COALESCE(NULLIF(document ->> 'title', ''), 'Documento'),
    COALESCE(NULLIF(document ->> 'category', ''), 'Documentos'),
    COALESCE(document ->> 'description', ''),
    document ->> 'original_name',
    COALESCE(NULLIF(document ->> 'mime_type', ''), 'application/octet-stream'),
    length(bytes),
    NULLIF(document ->> 'note_id', '')::UUID)
  RETURNING id INTO new_id;
  INSERT INTO document_files VALUES (new_id, bytes);
  RETURN new_id;
END;
$$;

-- Links assinados para os arquivos (valem 1 hora): {id: "id=...&exp=...&sig=..."}.
CREATE OR REPLACE FUNCTION public.file_links(ids UUID[]) RETURNS JSON
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = private, public AS $$
  WITH t AS (SELECT extract(epoch FROM NOW() + INTERVAL '1 hour')::BIGINT AS exp)
  SELECT COALESCE(json_object_agg(d.id,
    format('id=%s&exp=%s&sig=%s', d.id, t.exp, private.file_signature(d.id, t.exp))), '{}'::JSON)
  FROM public.documents d, t WHERE d.id = ANY(ids);
$$;

-- Tipo "*/*": o PostgREST devolve os bytes crus para qualquer Accept do navegador.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = '*/*') THEN CREATE DOMAIN "*/*" AS BYTEA; END IF;
END $$;

-- GET /rpc/file?id=...&exp=...&sig=...[&download=true]. Sem token: o link assinado basta.
CREATE OR REPLACE FUNCTION public.file(id UUID, exp BIGINT, sig TEXT, download BOOLEAN DEFAULT FALSE) RETURNS "*/*"
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = private, public AS $$
DECLARE
  doc public.documents;
  bytes BYTEA;
BEGIN
  IF exp < extract(epoch FROM NOW()) OR sig IS DISTINCT FROM private.file_signature(file.id, exp) THEN
    PERFORM set_config('response.status', '403', TRUE);
    RETURN NULL;
  END IF;
  SELECT * INTO doc FROM public.documents d WHERE d.id = file.id;
  SELECT f.data INTO bytes FROM document_files f WHERE f.document_id = file.id;
  IF bytes IS NULL THEN
    PERFORM set_config('response.status', '404', TRUE);
    RETURN NULL;
  END IF;
  PERFORM set_config('response.headers', json_build_array(
    json_build_object('Content-Type', doc.mime_type),
    json_build_object('Content-Disposition', format('%s; filename="%s"; filename*=UTF-8''''%s',
      CASE WHEN download THEN 'attachment' ELSE 'inline' END,
      regexp_replace(doc.original_name, '[^A-Za-z0-9._ -]', '_', 'g'),
      private.url_encode(doc.original_name))),
    json_build_object('Cache-Control', 'private, max-age=3600'),
    json_build_object('X-Content-Type-Options', 'nosniff'))::TEXT, TRUE);
  RETURN bytes;
END;
$$;

-- Reordena as páginas recebidas reaproveitando as posições que elas já ocupavam:
-- com busca ou filtro ativo, só as visíveis trocam de lugar.
CREATE OR REPLACE FUNCTION public.reorder_notes(ids UUID[]) RETURNS VOID
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  slots INTEGER[];
BEGIN
  SELECT ARRAY_AGG(position ORDER BY position) INTO slots FROM notes WHERE id = ANY(ids);
  IF COALESCE(ARRAY_LENGTH(slots, 1), 0) <> ARRAY_LENGTH(ids, 1) THEN
    RAISE EXCEPTION 'A lista mudou; recarregue o painel.';
  END IF;
  FOR i IN 1..ARRAY_LENGTH(ids, 1) LOOP
    UPDATE notes SET position = slots[i] WHERE id = ids[i];
  END LOOP;
END;
$$;

-- ---------- permissões ----------

REVOKE ALL ON ALL TABLES IN SCHEMA private FROM PUBLIC, anon, wiki_owner;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA public TO anon, wiki_owner;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notes, public.documents, public.bills, public.bill_payments TO wiki_owner;

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, wiki_owner;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.login(TEXT, TEXT), public.file(UUID, BIGINT, TEXT, BOOLEAN) TO anon, wiki_owner;
GRANT EXECUTE ON FUNCTION public.change_password(TEXT, TEXT), public.create_document(JSON, TEXT),
  public.file_links(UUID[]), public.reorder_notes(UUID[]), public.notes_default_position() TO wiki_owner;

NOTIFY pgrst, 'reload schema';
