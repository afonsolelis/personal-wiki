// Copia a wiki do PostgreSQL do Railway para o Supabase, sem apagar nada na origem.
// Pode rodar quantas vezes precisar: tudo é gravado com upsert pelo mesmo id.
//
//   npm run migrate:supabase
//
// Variáveis (no .env, nunca versionado): RAILWAY_DATABASE_URL, SUPABASE_DB_URL,
// SUPABASE_URL, SUPABASE_KEY (pública), OWNER_EMAIL, OWNER_PASSWORD.
// Não precisa da chave secreta: o usuário é criado pelo cadastro normal, confirmado
// via SQL, e os arquivos são enviados já logado como dono (respeitando as regras).
import 'dotenv/config';

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient } from '@supabase/supabase-js';
import pg from 'pg';

import { storageKey } from '../site/js/files.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function env(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Defina ${name} no .env.`);
  return value;
}

function pool(url) {
  const ssl = /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false };
  return new pg.Pool({ connectionString: url, ssl, max: 3 });
}

async function backup(source) {
  const tables = ['notes', 'documents', 'bills', 'bill_payments', 'tasks', 'app_settings'];
  const data = {};
  for (const table of tables) {
    const exists = await source.query('SELECT to_regclass($1) AS name', [`public.${table}`]);
    if (!exists.rows[0].name) continue;
    const { rows } = await source.query(`SELECT * FROM ${table}`);
    data[table] = rows.map((row) => (Buffer.isBuffer(row.content)
      ? { ...row, content: row.content.toString('base64') }
      : row));
  }
  const dir = path.join(root, 'backup');
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `railway-${new Date().toISOString().slice(0, 10)}.json`);
  await writeFile(file, JSON.stringify(data));
  console.log(`Backup completo do Railway salvo em ${path.relative(root, file)}.`);
}

async function ensureOwner(supabase, target) {
  const email = env('OWNER_EMAIL').toLowerCase();
  const password = env('OWNER_PASSWORD');
  const findUser = async () => (await target.query('SELECT id FROM auth.users WHERE lower(email) = $1', [email])).rows[0];

  if (!(await findUser())) {
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) throw new Error(`Não consegui criar o usuário (${error.message}). Verifique se o cadastro está liberado no Supabase Auth.`);
    console.log(`Usuário ${email} criado no Supabase Auth.`);
  } else {
    console.log(`Usuário ${email} já existia no Supabase Auth.`);
  }
  const user = await findUser();
  await target.query('UPDATE auth.users SET email_confirmed_at = COALESCE(email_confirmed_at, NOW()) WHERE id = $1', [user.id]);
  await target.query('INSERT INTO app_owner (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [user.id]);

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Login como dono falhou (${error.message}). A senha do .env confere com a do Supabase?`);
}

async function upsert(client, table, key, columns, rows) {
  const placeholders = columns.map((_column, index) => `$${index + 1}`).join(', ');
  const updates = columns.filter((column) => !key.includes(column))
    .map((column) => `${column} = EXCLUDED.${column}`).join(', ');
  for (const row of rows) {
    await client.query(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})
       ON CONFLICT (${key.join(', ')}) DO ${updates ? `UPDATE SET ${updates}` : 'NOTHING'}`,
      columns.map((column) => row[column]),
    );
  }
}

async function count(database, sql) {
  const { rows } = await database.query(sql);
  return rows[0];
}

async function main() {
  const source = pool(env('RAILWAY_DATABASE_URL'));
  // --backup-only: só salva a cópia local do Railway.
  if (process.argv.includes('--backup-only')) {
    try { await backup(source); } finally { await source.end(); }
    return;
  }
  const target = pool(env('SUPABASE_DB_URL'));
  const supabase = createClient(env('SUPABASE_URL'), env('SUPABASE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    await backup(source);

    await target.query(await readFile(path.join(root, 'supabase', 'schema.sql'), 'utf8'));
    console.log('Esquema aplicado no Supabase.');
    await ensureOwner(supabase, target);

    const notes = (await source.query('SELECT * FROM notes ORDER BY created_at')).rows;
    const bills = (await source.query('SELECT * FROM bills ORDER BY created_at')).rows;
    const payments = (await source.query('SELECT * FROM bill_payments')).rows;
    const documents = (await source.query('SELECT * FROM documents ORDER BY created_at')).rows;

    // Arquivos primeiro: a linha só entra no banco depois que o arquivo está no Storage.
    for (const document of documents) {
      document.storage_path = storageKey(document.id, document.original_name);
      const { error } = await supabase.storage.from('documents').upload(document.storage_path, document.content, {
        contentType: document.mime_type,
        upsert: true,
      });
      if (error) throw new Error(`Falha ao enviar ${document.original_name}: ${error.message}`);
      console.log(`  arquivo enviado: ${document.original_name}`);
    }

    const client = await target.connect();
    try {
      await client.query('BEGIN');
      await upsert(client, 'notes', ['id'], [
        'id', 'title', 'category', 'content', 'is_pinned', 'position', 'source_path', 'created_at', 'updated_at',
      ], notes);
      await upsert(client, 'documents', ['id'], [
        'id', 'title', 'category', 'description', 'original_name', 'mime_type', 'file_size',
        'storage_path', 'note_id', 'source_path', 'created_at', 'updated_at',
      ], documents);
      await upsert(client, 'bills', ['id'], ['id', 'name', 'created_at', 'updated_at'], bills);
      await upsert(client, 'bill_payments', ['bill_id', 'month'], ['bill_id', 'month', 'paid_at'], payments);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    // Conferência: mesmas quantidades e mesmos bytes dos dois lados.
    const totals = `SELECT
      (SELECT COUNT(*)::int FROM notes) AS paginas,
      (SELECT COUNT(*)::int FROM documents) AS documentos,
      (SELECT COALESCE(SUM(file_size), 0)::text FROM documents) AS bytes,
      (SELECT COUNT(*)::int FROM bills) AS contas,
      (SELECT COUNT(*)::int FROM bill_payments) AS checks`;
    const before = await count(source, totals);
    const after = await count(target, totals);
    const stored = await count(target, `SELECT COUNT(*)::int AS arquivos, COALESCE(SUM((metadata->>'size')::bigint), 0)::text AS bytes
      FROM storage.objects WHERE bucket_id = 'documents'`);

    console.table({ railway: before, supabase: after });
    console.log(`Storage: ${stored.arquivos} arquivo(s), ${stored.bytes} bytes.`);

    const same = Object.keys(before).every((key) => String(before[key]) === String(after[key]))
      && stored.arquivos === before.documentos && stored.bytes === before.bytes;
    if (!same) throw new Error('As contagens não batem. Nada foi apagado no Railway; revise antes de seguir.');
    console.log('Migração conferida: tudo igual nos dois lados.');
  } finally {
    await Promise.all([source.end(), target.end()]);
  }
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exitCode = 1;
});
