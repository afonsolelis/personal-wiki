-- Esquema da Personal Wiki no Supabase. Pode ser executado mais de uma vez.
-- Todo acesso passa pelas regras (RLS) abaixo: só o usuário dono enxerga os dados.

-- Dono do acervo. A migração grava aqui o id do usuário criado no Supabase Auth.
CREATE TABLE IF NOT EXISTS app_owner (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE
);

CREATE OR REPLACE FUNCTION is_owner() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM app_owner WHERE user_id = auth.uid());
$$;

CREATE TABLE IF NOT EXISTS notes (
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

-- O arquivo em si fica no Storage (bucket "documents"); aqui só os metadados.
CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(180) NOT NULL,
  category VARCHAR(80) NOT NULL DEFAULT 'Documentos',
  description TEXT NOT NULL DEFAULT '',
  original_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(160) NOT NULL,
  file_size BIGINT NOT NULL CHECK (file_size >= 0),
  storage_path TEXT NOT NULL UNIQUE,
  note_id UUID REFERENCES notes(id) ON DELETE SET NULL,
  source_path TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(120) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Um registro por conta marcada no mês; zerar o mês apaga os registros dele.
CREATE TABLE IF NOT EXISTS bill_payments (
  bill_id UUID NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  month DATE NOT NULL,
  paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (bill_id, month)
);

CREATE INDEX IF NOT EXISTS idx_notes_position ON notes (position);
CREATE INDEX IF NOT EXISTS idx_documents_updated_at ON documents (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_note_id ON documents (note_id);

-- Página nova entra no topo da lista.
CREATE OR REPLACE FUNCTION notes_default_position() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.position IS NULL THEN
    SELECT COALESCE(MIN(position), 1) - 1 INTO NEW.position FROM notes;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notes_default_position ON notes;
CREATE TRIGGER notes_default_position BEFORE INSERT ON notes
  FOR EACH ROW EXECUTE FUNCTION notes_default_position();

-- Reordena as páginas recebidas reaproveitando as posições que elas já ocupavam:
-- com busca ou filtro ativo, só as visíveis trocam de lugar.
CREATE OR REPLACE FUNCTION reorder_notes(ids UUID[]) RETURNS VOID
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  slots INTEGER[];
BEGIN
  IF NOT is_owner() THEN RAISE EXCEPTION 'não autorizado'; END IF;
  SELECT ARRAY_AGG(position ORDER BY position) INTO slots FROM notes WHERE id = ANY(ids);
  IF COALESCE(ARRAY_LENGTH(slots, 1), 0) <> ARRAY_LENGTH(ids, 1) THEN
    RAISE EXCEPTION 'A lista mudou; recarregue o painel.';
  END IF;
  FOR i IN 1..ARRAY_LENGTH(ids, 1) LOOP
    UPDATE notes SET position = slots[i] WHERE id = ids[i];
  END LOOP;
END;
$$;

-- Regras de acesso: tudo liberado para o dono, nada para os demais.
ALTER TABLE app_owner ENABLE ROW LEVEL SECURITY;
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE bill_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS owner_all ON notes;
CREATE POLICY owner_all ON notes FOR ALL TO authenticated USING (is_owner()) WITH CHECK (is_owner());
DROP POLICY IF EXISTS owner_all ON documents;
CREATE POLICY owner_all ON documents FOR ALL TO authenticated USING (is_owner()) WITH CHECK (is_owner());
DROP POLICY IF EXISTS owner_all ON bills;
CREATE POLICY owner_all ON bills FOR ALL TO authenticated USING (is_owner()) WITH CHECK (is_owner());
DROP POLICY IF EXISTS owner_all ON bill_payments;
CREATE POLICY owner_all ON bill_payments FOR ALL TO authenticated USING (is_owner()) WITH CHECK (is_owner());

REVOKE ALL ON app_owner, notes, documents, bills, bill_payments FROM anon;
REVOKE EXECUTE ON FUNCTION reorder_notes(UUID[]) FROM anon, public;
GRANT EXECUTE ON FUNCTION reorder_notes(UUID[]) TO authenticated;

-- Bucket privado para os arquivos, com as mesmas regras. Limite de 50 MB (máximo do
-- plano grátis) porque um anexo antigo tem 34 MB; o site limita envios novos a 10 MB.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('documents', 'documents', FALSE, 52428800)
ON CONFLICT (id) DO UPDATE SET public = FALSE, file_size_limit = EXCLUDED.file_size_limit;

DROP POLICY IF EXISTS documents_owner_all ON storage.objects;
CREATE POLICY documents_owner_all ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'documents' AND public.is_owner())
  WITH CHECK (bucket_id = 'documents' AND public.is_owner());
