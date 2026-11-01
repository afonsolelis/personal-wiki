# Personal Wiki

Wiki pessoal estática, publicada no GitHub Pages, com os dados no Supabase (plano gratuito).

## Como funciona

- **Site** (`site/`): HTML, CSS e JavaScript puros, sem servidor. Fala direto com o Supabase.
- **Login**: a tela pede só a senha; o e-mail do dono vem da configuração. A senha fica no
  Supabase Auth, nunca no código.
- **Segurança**: regras de acesso do banco (RLS) liberam páginas, documentos e contas apenas
  para o usuário registrado em `app_owner`. Sem login, nada é devolvido. A chave usada no site é
  a pública do Supabase, feita para ficar exposta.
- **Arquivos**: bucket privado `documents` no Supabase Storage, aberto por links assinados
  que expiram em 1 hora.

Telas: visão geral (busca, filtro, reordenar páginas arrastando), páginas em Markdown com
anexos, biblioteca de documentos e checklist mensal de contas a pagar.

## Publicação

O workflow `.github/workflows/pages.yml` roda os testes, monta o site em `dist/` e publica no
GitHub Pages a cada push na `main`. Ele lê três **variáveis do repositório**
(Settings → Secrets and variables → Actions → Variables):

| Variável       | Valor                                         |
| -------------- | --------------------------------------------- |
| `SUPABASE_URL` | URL do projeto Supabase                       |
| `SUPABASE_KEY` | chave pública (publishable/anon)              |
| `OWNER_EMAIL`  | e-mail do usuário dono no Supabase Auth       |

Para trocar a senha: painel do Supabase → Authentication → Users → usuário → Reset/Update password.

## Rodar localmente

```bash
cp .env.example .env   # preencha SUPABASE_URL, SUPABASE_KEY e OWNER_EMAIL
npm install
npm run dev            # http://localhost:3010
npm test
```

## Banco de dados

- `supabase/schema.sql`: tabelas, regras de acesso, bucket e funções. Pode rodar mais de uma vez.
- `scripts/migrate-to-supabase.js`: migração única feita a partir do antigo PostgreSQL do
  Railway (salva um backup local em `backup/`, que não vai para o Git, e confere as contagens).

## Histórico

Até novembro de 2026 a wiki rodava como servidor Express + EJS no Railway, com os arquivos
gravados no próprio PostgreSQL. Esse código continua no histórico do Git.
