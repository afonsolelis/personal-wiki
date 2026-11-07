// Migração do Supabase (lwamaovuxcevsjfvtqhf) para o Postgres + PostgREST da VPS.
// Pode rodar de novo: apaga e recarrega todos os dados da wiki no destino.
//
//   ssh -f -N -L 55435:127.0.0.1:55435 root@srv2127534.hstgr.cloud
//   npm run migrate:postgrest
//
// Lê do .env: SUPABASE_DB_URL, SUPABASE_URL, SUPABASE_KEY, OWNER_EMAIL, OWNER_PASSWORD
// (para baixar os arquivos do bucket com o login do dono) e WIKI_DB_URL (destino).
// Os arquivos baixados ficam também em backup/supabase-<data>/ (fora do Git).
import 'dotenv/config';

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient } from '@supabase/supabase-js';
import pg from 'pg';

const required = ['SUPABASE_DB_URL', 'SUPABASE_URL', 'SUPABASE_KEY', 'OWNER_EMAIL', 'OWNER_PASSWORD', 'WIKI_DB_URL'];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) throw new Error(`Faltam variáveis no .env: ${missing.join(', ')}`);

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const backupDir = path.join(root, 'backup', `supabase-${new Date().toISOString().slice(0, 10)}`);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

const source = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL });
const target = new pg.Client({ connectionString: process.env.WIKI_DB_URL });
await source.connect();
await target.connect();

console.log('1/4 lendo o Supabase');
const rows = {
  notes: (await source.query('SELECT * FROM notes ORDER BY position, created_at')).rows,
  documents: (await source.query('SELECT * FROM documents ORDER BY created_at')).rows,
  bills: (await source.query('SELECT * FROM bills ORDER BY created_at')).rows,
  bill_payments: (await source.query('SELECT * FROM bill_payments ORDER BY month, bill_id')).rows,
};
const { rows: [owner] } = await source.query(
  'SELECT u.email, u.encrypted_password FROM app_owner a JOIN auth.users u ON u.id = a.user_id');
if (!owner?.encrypted_password?.startsWith('$2')) throw new Error('Senha do dono não encontrada no Supabase Auth.');
for (const [table, list] of Object.entries(rows)) console.log(`   ${table}: ${list.length}`);

console.log('2/4 baixando os arquivos do bucket');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, { auth: { persistSession: false } });
const { error: loginError } = await supabase.auth.signInWithPassword({
  email: process.env.OWNER_EMAIL, password: process.env.OWNER_PASSWORD,
});
if (loginError) throw new Error(`Login no Supabase falhou: ${loginError.message}`);
await mkdir(backupDir, { recursive: true });
const files = new Map();
for (const document of rows.documents) {
  const { data, error } = await supabase.storage.from('documents').download(document.storage_path);
  if (error) throw new Error(`Falha ao baixar ${document.storage_path}: ${error.message}`);
  const bytes = Buffer.from(await data.arrayBuffer());
  if (bytes.length !== Number(document.file_size)) {
    console.warn(`   aviso: ${document.original_name} tem ${bytes.length} bytes (tabela diz ${document.file_size})`);
  }
  files.set(document.id, bytes);
  await writeFile(path.join(backupDir, `${document.id}-${path.basename(document.storage_path)}`), bytes);
  console.log(`   ${document.original_name} (${(bytes.length / 1024 / 1024).toFixed(1)} MB)`);
}
await writeFile(path.join(backupDir, 'dados.json'), JSON.stringify(rows, null, 2));
await supabase.auth.signOut();

console.log('3/4 gravando na VPS');
const insert = async (table, list, columns) => {
  for (const row of list) {
    const values = columns.map((column) => row[column]);
    const marks = columns.map((_, index) => `$${index + 1}`).join(', ');
    await target.query(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${marks})`, values);
  }
};
try {
  await target.query('BEGIN');
  await target.query('TRUNCATE public.notes, public.documents, public.bills, public.bill_payments, private.document_files CASCADE');
  // A posição vem da origem; o gatilho só preenche quando ela é nula.
  await insert('public.notes', rows.notes,
    ['id', 'title', 'category', 'content', 'is_pinned', 'position', 'source_path', 'created_at', 'updated_at']);
  await insert('public.documents', rows.documents, ['id', 'title', 'category', 'description', 'original_name',
    'mime_type', 'file_size', 'note_id', 'source_path', 'created_at', 'updated_at']);
  for (const [id, bytes] of files) {
    await target.query('INSERT INTO private.document_files (document_id, data) VALUES ($1, $2)', [id, bytes]);
  }
  await insert('public.bills', rows.bills, ['id', 'name', 'created_at', 'updated_at']);
  await insert('public.bill_payments', rows.bill_payments, ['bill_id', 'month', 'paid_at']);
  await target.query(`INSERT INTO private.owner (email, password_hash) VALUES (lower($1), $2)
    ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash`, [owner.email, owner.encrypted_password]);
  await target.query('COMMIT');
} catch (error) {
  await target.query('ROLLBACK');
  throw error;
}

console.log('4/4 conferindo');
let ok = true;
for (const table of Object.keys(rows)) {
  const { rows: [{ n }] } = await target.query(`SELECT COUNT(*)::INT AS n FROM public.${table}`);
  const same = n === rows[table].length;
  ok &&= same;
  console.log(`   ${table}: ${n} ${same ? 'ok' : `DIFERENTE (origem ${rows[table].length})`}`);
}
const { rows: stored } = await target.query('SELECT document_id, data FROM private.document_files');
const sameFiles = stored.length === files.size && stored.every((row) => sha(row.data) === sha(files.get(row.document_id)));
ok &&= sameFiles;
console.log(`   arquivos: ${stored.length} ${sameFiles ? 'ok (sha256 igual)' : 'DIFERENTE'}`);
console.log(`   backup local: ${path.relative(root, backupDir)}`);

await source.end();
await target.end();
if (!ok) process.exit(1);
console.log('Migração concluída.');
