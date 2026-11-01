// Monta o site em dist/: copia site/, gera config.js e carimba a versão nos links.
// No GitHub Actions as variáveis vêm do repositório; localmente, do .env.
import 'dotenv/config';

import { cp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');

const config = {
  supabaseUrl: process.env.SUPABASE_URL ?? '',
  // Chave pública (publishable/anon). Nunca use a chave secreta aqui.
  supabaseKey: process.env.SUPABASE_KEY ?? '',
  ownerEmail: process.env.OWNER_EMAIL ?? '',
};

const missing = Object.entries(config).filter(([, value]) => !value).map(([key]) => key);
if (missing.length) throw new Error(`Faltam variáveis para o site: ${missing.join(', ')}`);
function isSecretKey(key) {
  if (key.startsWith('sb_secret_')) return true;
  try {
    return Buffer.from(key.split('.')[1] ?? '', 'base64url').toString().includes('service_role');
  } catch {
    return false;
  }
}
if (isSecretKey(config.supabaseKey)) {
  throw new Error('SUPABASE_KEY é a chave secreta. Use a chave pública (publishable/anon).');
}

const version = (process.env.GITHUB_SHA ?? Date.now().toString(36)).slice(0, 10);

await rm(dist, { recursive: true, force: true });
await cp(path.join(root, 'site'), dist, { recursive: true });
await writeFile(path.join(dist, 'config.js'), `window.WIKI_CONFIG = ${JSON.stringify(config)};\n`);
const index = path.join(dist, 'index.html');
await writeFile(index, (await readFile(index, 'utf8')).replaceAll('__VERSION__', version));
console.log(`Site montado em dist/ (versão ${version}).`);
