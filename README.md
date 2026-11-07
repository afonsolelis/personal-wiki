# Personal Wiki

Wiki pessoal estática, publicada no GitHub Pages, com os dados num Postgres + PostgREST próprio
(VPS da Hostinger, gerenciado pelo Coolify).

## Como funciona

- **Site** (`site/`): HTML, CSS e JavaScript puros, sem servidor. Fala direto com a API
  (`site/js/api.js`, um cliente `fetch` mínimo do PostgREST).
- **API**: https://wiki-api.afonsolelis.tech (PostgREST v14 na frente do Postgres 17).
- **Login**: a tela pede só a senha; o e-mail do dono vem da configuração. `POST /rpc/login`
  confere a senha (bcrypt em `private.owner`) e devolve um JWT de 30 dias, guardado no
  navegador. Depois de 10 erros em 15 minutos o login fica bloqueado por um tempo.
- **Segurança**: sem token, o papel `anon` só consegue chamar `login` e abrir arquivos com link
  assinado. Com o token, o papel `wiki_owner` lê e grava as tabelas.
- **Arquivos**: os bytes ficam em `private.document_files` (fora da API). A tela pede links
  assinados (`rpc/file_links`, valem 1 hora) e o arquivo sai de `GET /rpc/file`.

Telas: visão geral (busca, filtro, reordenar páginas arrastando), páginas em Markdown com
anexos, biblioteca de documentos e checklist mensal de contas a pagar.

## Publicação

O workflow `.github/workflows/pages.yml` roda os testes, monta o site em `dist/` e publica no
GitHub Pages a cada push na `main`. Ele lê duas **variáveis do repositório**
(Settings → Secrets and variables → Actions → Variables):

| Variável      | Valor                                  |
| ------------- | -------------------------------------- |
| `API_URL`     | `https://wiki-api.afonsolelis.tech`    |
| `OWNER_EMAIL` | e-mail do dono (o mesmo de `private.owner`) |

## Servidor

- Projeto `personal-wiki` no Coolify, service `0uivq8se6zcxcgb2c9ctjruc`. O compose e as senhas
  (`WIKI_*`) ficam na pasta `hostinger` (fora deste repositório).
- Postgres sem porta pública, só `127.0.0.1:55435` na VPS. Dados em `/data/personal-wiki/pgdata`.
- `postgrest/schema.sql`: papéis, tabelas, funções e permissões. Pode rodar mais de uma vez:

  ```bash
  ssh root@srv2127534.hstgr.cloud "docker exec -i postgres-0uivq8se6zcxcgb2c9ctjruc psql -U postgres -d wiki \
    -v ON_ERROR_STOP=1 -v auth_password=... -v jwt_secret=..." < postgrest/schema.sql
  ```

- Trocar a senha: `POST /rpc/change_password {current_password, new_password}` com o token, ou
  direto no banco:

  ```sql
  UPDATE private.owner SET password_hash = crypt('nova-senha', gen_salt('bf', 10));
  ```

## Rodar localmente

```bash
cp .env.example .env   # preencha API_URL e OWNER_EMAIL
npm install
npm run dev            # http://localhost:3010 (já liberado no CORS da API)
npm test
```

## Histórico

- Até 01/11/2026: servidor Express + EJS no Railway.
- 01/11 a 07/11/2026: site estático com dados no Supabase.
- Desde 07/11/2026: dados no Postgres + PostgREST da VPS. A cópia saiu do Supabase com
  `scripts/migrate-to-postgrest.js`, que confere contagens e o sha256 de cada arquivo.
