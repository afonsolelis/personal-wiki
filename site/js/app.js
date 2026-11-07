import MarkdownIt from 'https://cdn.jsdelivr.net/npm/markdown-it@14.1.0/+esm';
import markdownItTaskLists from 'https://cdn.jsdelivr.net/npm/markdown-it-task-lists@2.1.1/+esm';

import { createApi, eq } from './api.js';
import { monthLabel, parseMonth, shiftMonth, todayIso } from './bills.js';
import {
  acceptedExtensions, fileBadge, formatBytes, isAccepted, maxUploadMb, readBase64, searchKey, titleFromFilename,
} from './files.js';
import { enableReorder } from './reorder.js';

const config = window.WIKI_CONFIG ?? {};
const app = document.getElementById('app');

if (!config.apiUrl || !config.ownerEmail) {
  app.innerHTML = `<main class="shell"><section class="error-page"><span>⚙</span><h1>Configuração ausente</h1>
    <p>Defina API_URL e OWNER_EMAIL nas variáveis do repositório e publique de novo.</p></section></main>`;
  throw new Error('config.js ausente ou incompleto');
}

// Token vencido ou recusado: volta para a tela de login.
const api = createApi(config.apiUrl, {
  onUnauthorized() {
    setFlash('error', 'Sua sessão expirou. Entre de novo.');
    setTimeout(route);
  },
});
const markdown = new MarkdownIt({ html: false, linkify: true, typographer: true })
  .use(markdownItTaskLists, { enabled: false, label: false });

const acceptAttr = acceptedExtensions.join(',');
const pageCategories = ['Geral', 'Formação', 'Trabalho', 'Pessoal', 'Guias', 'Rotinas'];
const documentCategories = ['Documentos', 'Formação', 'Empresa', 'Pessoal', 'Imagens'];

let flash = null;

// ---------- utilidades ----------

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

function formatDate(value) {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Sao_Paulo',
  }).format(new Date(value));
}

function setFlash(type, message) {
  flash = { type, message };
}

function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

function parseRoute() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, search = ''] = raw.split('?');
  return { path, query: new URLSearchParams(search) };
}

function badge(mimeType) {
  const { label, className } = fileBadge(mimeType);
  return `<div class="file-badge ${className}">${label}</div>`;
}

// Links assinados valem 1 hora; o download usa o nome original do arquivo.
async function fileLinks(documents) {
  if (!documents.length) return {};
  const signed = await api.rpc('file_links', { ids: documents.map((item) => item.id) });
  return Object.fromEntries(documents.map((item) => {
    const query = signed[item.id];
    return [item.id, query
      ? { view: api.fileUrl(query), download: api.fileUrl(query, true) }
      : { view: '#', download: '#' }];
  }));
}

function fileActions(links, id, withEdit = false) {
  const link = links[id] ?? { view: '#', download: '#' };
  return `<div class="row-actions">
    <a class="icon-button" href="${esc(link.view)}" target="_blank" rel="noopener" title="Visualizar">↗</a>
    <a class="icon-button" href="${esc(link.download)}" title="Baixar">↓</a>
    ${withEdit ? `<a class="icon-button" href="#/documents/${id}/edit" title="Editar">✎</a>` : ''}
  </div>`;
}

function validateFiles(files) {
  for (const file of files) {
    if (!isAccepted(file.name)) {
      throw new Error(`“${file.name}” não é aceito. Use PDF, imagem, texto, Office ou ZIP.`);
    }
    if (file.size > maxUploadMb * 1024 * 1024) {
      throw new Error(`“${file.name}” passa de ${maxUploadMb} MB.`);
    }
  }
  if (files.length > 10) throw new Error('Envie no máximo 10 arquivos por vez.');
}

async function uploadFiles(files, { category, description, noteId }) {
  for (const file of files) {
    await api.rpc('create_document', {
      document: {
        title: titleFromFilename(file.name).slice(0, 180) || 'Documento',
        category: category || 'Documentos',
        description: description || '',
        original_name: file.name.slice(0, 255),
        mime_type: file.type || 'application/octet-stream',
        note_id: noteId || null,
      },
      data: await readBase64(file),
    });
  }
}

function busy(form, isBusy) {
  form.querySelectorAll('button[type="submit"]').forEach((button) => { button.disabled = isBusy; });
}

// ---------- layout ----------

function layout(active, title, body) {
  document.title = `${title} · Personal Wiki`;
  document.body.className = '';
  const name = config.ownerEmail.split('@')[0].split('+')[0];
  // No celular a barra inferior mostra ícone + rótulo curto.
  const link = (key, href, icon, label, short) => `<a class="${active === key ? 'active' : ''}" href="${href}" aria-label="${label}"${active === key ? ' aria-current="page"' : ''}>
    <span class="nav-icon" aria-hidden="true">${icon}</span><span class="nav-label">${label}</span><span class="nav-short" aria-hidden="true">${short}</span></a>`;
  const message = flash;
  flash = null;
  app.innerHTML = `
    <header class="topbar">
      <a class="brand" href="#/" aria-label="Página inicial">
        <span class="brand-mark">W</span>
        <span><strong>Personal Wiki</strong><small>acervo pessoal</small></span>
      </a>
      <nav class="main-nav" aria-label="Navegação principal">
        ${link('dashboard', '#/', '▤', 'Visão geral', 'Início')}
        ${link('pages', '#/pages/new', '✎', 'Nova página', 'Página')}
        ${link('documents', '#/documents/new', '⇪', 'Enviar arquivo', 'Arquivo')}
        ${link('bills', '#/bills', '✓', 'Contas a pagar', 'Contas')}
      </nav>
      <div class="user-menu">
        <span class="user-avatar">${esc(name.slice(0, 1).toUpperCase())}</span>
        <span class="user-name">${esc(name)}</span>
        <button class="text-button" type="button" data-action="logout">Sair</button>
      </div>
    </header>
    <main class="shell">
      ${message ? `<div class="flash flash-${message.type}" role="status">${esc(message.message)}</div>` : ''}
      ${body}
    </main>
    <footer class="footer">Personal Wiki · dados protegidos em servidor próprio</footer>`;
}

function loading() {
  const main = app.querySelector('main.shell');
  if (main) main.innerHTML = '<p class="loading">Carregando…</p>';
}

function errorPage(title, message, status = '') {
  layout('', title, `<section class="error-page">
    <span>${esc(status)}</span><h1>${esc(title)}</h1><p>${esc(message)}</p>
    <a class="button button-primary" href="#/">Voltar ao acervo</a></section>`);
}

// Põe um botão "Copiar" no canto de cada bloco de código renderizado.
function addCopyButtons(container) {
  container?.querySelectorAll('pre').forEach((pre) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'code-block';
    pre.replaceWith(wrapper);
    wrapper.append(pre);
    wrapper.insertAdjacentHTML('beforeend',
      '<button class="copy-code" type="button" data-action="copy-code" aria-label="Copiar código">Copiar</button>');
  });
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Navegadores sem a API de área de transferência.
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;opacity:0';
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    if (!ok) throw new Error('Não foi possível copiar.');
  }
}

function bindFileLabels() {
  app.querySelectorAll('input[type="file"]').forEach((input) => {
    input.addEventListener('change', () => {
      const target = app.querySelector(`[data-file-label="${input.id}"]`);
      if (!target) return;
      const count = input.files.length;
      target.textContent = count ? `${count} arquivo(s) selecionado(s)` : 'Nenhum arquivo selecionado';
    });
  });
}

// ---------- login ----------

function loginView() {
  document.title = 'Entrar · Personal Wiki';
  document.body.className = 'login-body';
  const message = flash;
  flash = null;
  app.innerHTML = `
    <main class="login-shell">
      <section class="login-intro">
        <span class="eyebrow light">Seu espaço privado</span>
        <h1>Ideias, registros e documentos em um só lugar.</h1>
        <p>Um acervo simples para guardar o que importa e encontrar tudo sem esforço.</p>
        <div class="intro-detail"><span class="intro-icon">⌁</span><span>Dados protegidos em servidor próprio</span></div>
      </section>
      <section class="login-panel">
        <div class="login-card">
          <div class="login-logo">W</div>
          <span class="eyebrow">Área reservada</span>
          <h2>Bem-vindo de volta</h2>
          <p>Digite sua senha para acessar o acervo.</p>
          ${message ? `<div class="flash flash-${message.type}" role="alert">${esc(message.message)}</div>` : ''}
          <form class="stacked-form" id="login-form">
            <input type="email" name="username" autocomplete="username" value="${esc(config.ownerEmail)}" hidden>
            <label>
              <span>Senha</span>
              <input type="password" name="password" autocomplete="current-password" required autofocus>
            </label>
            <button class="button button-primary button-block" type="submit">Entrar no acervo</button>
          </form>
          <small class="security-note">Sua sessão permanece ativa neste navegador.</small>
        </div>
      </section>
    </main>`;

  const form = document.getElementById('login-form');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    busy(form, true);
    try {
      await api.login(config.ownerEmail, form.elements.password.value);
      route();
    } catch (error) {
      setFlash('error', error.status === 401 || error.status === 429
        ? error.message : 'Não foi possível entrar agora. Tente de novo.');
      loginView();
    }
  });
}

// ---------- visão geral ----------

async function dashboardView(query) {
  const search = (query.get('q') ?? '').trim().slice(0, 120);
  const category = (query.get('category') ?? '').trim().slice(0, 80);

  const [allNotes, allDocuments] = await Promise.all([
    api.get('notes?select=id,title,category,content,is_pinned,position,updated_at&order=position.asc,updated_at.desc'),
    api.get('documents?select=id,title,category,description,original_name,mime_type,file_size,updated_at,note_id'
      + '&order=updated_at.desc'),
  ]);

  const term = searchKey(search);
  const matches = (category ? (item) => item.category === category : () => true);
  const noteTitles = Object.fromEntries(allNotes.map((note) => [note.id, note.title]));
  const attachmentCount = {};
  allDocuments.forEach((item) => { if (item.note_id) attachmentCount[item.note_id] = (attachmentCount[item.note_id] ?? 0) + 1; });

  const notes = allNotes.filter((note) => matches(note)
    && (!term || searchKey(note.title, note.content, note.category).includes(term)));
  const documents = allDocuments.filter((item) => matches(item)
    && (!term || searchKey(item.title, item.description, item.original_name).includes(term)));
  const categories = [...new Set([...allNotes, ...allDocuments].map((item) => item.category))]
    .sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const totalBytes = allDocuments.reduce((sum, item) => sum + Number(item.file_size), 0);
  const links = await fileLinks(documents);

  const pageCards = notes.map((page) => {
    const excerpt = page.content.replace(/[#*_`>\[\]]/g, '').replace(/\s+/g, ' ').slice(0, 190);
    return `
      <article class="page-card" data-page-id="${page.id}">
        <div class="page-card-top">
          <div class="page-card-meta">
            <button class="drag-handle" type="button" aria-label="Reordenar a página ${esc(page.title)}" title="Arraste para reordenar">⠿</button>
            <span class="category-pill">${esc(page.category)}</span>
          </div>
          ${page.is_pinned ? '<span class="pin" title="Página fixada">◆</span>' : ''}
        </div>
        <h3><a class="page-card-link" href="#/pages/${page.id}" aria-label="Abrir página ${esc(page.title)}">${esc(page.title)}</a></h3>
        <p>${esc(excerpt || 'Página sem conteúdo.')}${page.content.length > 190 ? '…' : ''}</p>
        <div class="page-card-footer">
          <span>${attachmentCount[page.id] ?? 0} anexo(s)</span>
          <span class="open-page">Abrir página →</span>
          <div class="card-actions" aria-label="Ações da página ${esc(page.title)}">
            <a class="card-action card-action-edit" href="#/pages/${page.id}/edit">Editar</a>
            <button class="card-action card-action-delete" type="button" data-action="delete-page" data-id="${page.id}"
              data-confirm="Excluir a página “${esc(page.title)}”? Os documentos anexados serão preservados.">Excluir</button>
          </div>
        </div>
      </article>`;
  }).join('');

  const documentRows = documents.map((item) => `
    <article class="document-row">
      ${badge(item.mime_type)}
      <div class="document-main">
        <strong>${esc(item.title)}</strong>
        <span>${esc(item.original_name)} · ${formatBytes(item.file_size)}</span>
        ${item.note_id && noteTitles[item.note_id] ? `<a href="#/pages/${item.note_id}">Anexo de “${esc(noteTitles[item.note_id])}”</a>` : ''}
      </div>
      <span class="category-pill">${esc(item.category)}</span>
      ${fileActions(links, item.id, true)}
    </article>`).join('');

  layout('dashboard', 'Visão geral', `
    <section class="hero-row">
      <div>
        <span class="eyebrow">Visão geral</span>
        <h1>Seu acervo, organizado.</h1>
        <p>Crie páginas, reúna contexto e mantenha os documentos importantes sempre à mão.</p>
      </div>
      <div class="hero-actions">
        <a class="button button-secondary" href="#/documents/new">Enviar arquivo</a>
        <a class="button button-primary" href="#/pages/new">＋ Nova página</a>
      </div>
    </section>

    <section class="stats-grid" aria-label="Resumo do acervo">
      <article class="stat-card"><span class="stat-icon stat-blue">▤</span><div><strong>${allNotes.length}</strong><span>páginas</span></div></article>
      <article class="stat-card"><span class="stat-icon stat-amber">⌑</span><div><strong>${allDocuments.length}</strong><span>documentos</span></div></article>
      <article class="stat-card"><span class="stat-icon stat-green">◫</span><div><strong>${formatBytes(totalBytes)}</strong><span>armazenados</span></div></article>
    </section>

    <form class="filter-bar" id="filter-form">
      <label class="search-field">
        <span aria-hidden="true">⌕</span>
        <input type="search" name="q" value="${esc(search)}" placeholder="Buscar em páginas e documentos…" aria-label="Buscar">
      </label>
      <select name="category" aria-label="Filtrar por categoria">
        <option value="">Todas as categorias</option>
        ${categories.map((item) => `<option value="${esc(item)}" ${item === category ? 'selected' : ''}>${esc(item)}</option>`).join('')}
      </select>
      <button class="button button-dark" type="submit">Filtrar</button>
      ${search || category ? '<a class="clear-filter" href="#/">Limpar</a>' : ''}
    </form>

    <section class="content-section">
      <div class="section-heading">
        <div><span class="eyebrow">Conteúdo</span><h2>Páginas</h2></div>
        <span class="result-count">${notes.length} encontrada(s)${notes.length > 1 ? ' · arraste o ⠿ para reordenar' : ''}</span>
      </div>
      ${notes.length ? `<div class="page-grid" data-reorder>${pageCards}</div>` : `
        <div class="empty-state">
          <span>▤</span><h3>Nenhuma página encontrada</h3>
          <p>Crie uma página para começar a organizar suas informações.</p>
          <a class="button button-primary" href="#/pages/new">Criar página</a>
        </div>`}
    </section>

    <section class="content-section" id="documentos">
      <div class="section-heading">
        <div><span class="eyebrow">Arquivos</span><h2>Documentos</h2></div>
        <a class="subtle-link" href="#/documents/new">＋ Adicionar documentos</a>
      </div>
      ${documents.length ? `<div class="document-list">${documentRows}</div>` : `
        <div class="empty-state compact">
          <span>⌑</span><h3>Nenhum documento encontrado</h3>
          <p>Envie PDFs, imagens, textos, arquivos do Office ou ZIP de até ${maxUploadMb} MB.</p>
        </div>`}
    </section>`);

  document.getElementById('filter-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const params = new URLSearchParams();
    const form = event.currentTarget;
    if (form.elements.q.value.trim()) params.set('q', form.elements.q.value.trim());
    if (form.elements.category.value) params.set('category', form.elements.category.value);
    go(params.size ? `#/?${params}` : '#/');
  });

  const grid = app.querySelector('[data-reorder]');
  if (grid && notes.length > 1) {
    enableReorder(grid, (ids) => api.rpc('reorder_notes', { ids }));
  }
  if (query.get('section') === 'documentos') document.getElementById('documentos').scrollIntoView();
}

// ---------- páginas ----------

async function loadPage(id) {
  return api.one(`notes?id=${eq(id)}`);
}

async function loadAttachments(noteId) {
  return api.get(`documents?select=id,title,original_name,mime_type,file_size,updated_at&note_id=${eq(noteId)}`
    + '&order=updated_at.desc');
}

async function pageView(id) {
  const [page, documents] = await Promise.all([loadPage(id), loadAttachments(id)]);
  if (!page) return errorPage('Página não encontrada', 'Essa página não existe.', '404');
  const links = await fileLinks(documents);

  layout('', page.title, `
    <a class="back-floating" href="#/" aria-label="Voltar para todas as páginas"><span aria-hidden="true">←</span> Todas as páginas</a>
    <article class="page-view">
      <header class="page-view-header">
        <div>
          <div class="page-meta">
            <span class="category-pill">${esc(page.category)}</span>
            ${page.is_pinned ? '<span class="pinned-label">◆ Fixada</span>' : ''}
          </div>
          <h1>${esc(page.title)}</h1>
          <p>Atualizada em ${formatDate(page.updated_at)}</p>
        </div>
        <div class="hero-actions"><a class="button button-secondary" href="#/pages/${page.id}/edit">✎ Editar página</a></div>
      </header>

      <div class="page-content prose">
        ${page.content ? markdown.render(page.content) : '<p class="muted">Esta página ainda não tem conteúdo.</p>'}
      </div>

      <section class="attachments">
        <div class="section-heading">
          <div><span class="eyebrow">Arquivos relacionados</span><h2>Anexos</h2></div>
          <a class="subtle-link" href="#/pages/${page.id}/edit">＋ Adicionar anexo</a>
        </div>
        ${documents.length ? `<div class="attachment-grid">${documents.map((item) => `
          <article class="attachment-card">
            ${badge(item.mime_type)}
            <div><strong>${esc(item.title)}</strong><span>${formatBytes(item.file_size)}</span></div>
            ${fileActions(links, item.id)}
          </article>`).join('')}</div>` : '<p class="muted">Nenhum documento anexado a esta página.</p>'}
      </section>

      <section class="danger-zone">
        <div><strong>Remover página</strong><span>Os documentos serão preservados na biblioteca geral.</span></div>
        <button class="button button-danger-ghost" type="button" data-action="delete-page" data-id="${page.id}"
          data-confirm="Remover esta página? Os documentos anexados serão preservados.">Remover</button>
      </section>
    </article>`);
  addCopyButtons(app.querySelector('.page-content'));
}

async function pageFormView(id) {
  let page = null;
  let documents = [];
  if (id) {
    [page, documents] = await Promise.all([loadPage(id), loadAttachments(id)]);
    if (!page) return errorPage('Página não encontrada', 'Essa página não existe.', '404');
  }
  const links = await fileLinks(documents);
  const back = page ? `#/pages/${page.id}` : '#/';

  layout('pages', page ? 'Editar página' : 'Nova página', `
    <div class="back-row"><a href="${back}">← Voltar</a></div>
    <section class="form-heading">
      <span class="eyebrow">${page ? 'Atualizar conteúdo' : 'Adicionar conteúdo'}</span>
      <h1>${page ? 'Editar página' : 'Nova página'}</h1>
      <p>Organize o texto e anexe os documentos relacionados no mesmo lugar.</p>
    </section>

    <form class="editor-layout" id="page-form">
      <section class="form-card editor-main">
        <label>
          <span>Título da página</span>
          <input name="title" maxlength="180" value="${esc(page?.title)}" placeholder="Ex.: Documentos acadêmicos" required autofocus>
        </label>
        <label>
          <span>Conteúdo</span>
          <textarea name="content" rows="20" placeholder="Escreva aqui. Você pode usar Markdown para títulos, listas e links.">${esc(page?.content)}</textarea>
          <small>Aceita Markdown: # título, **negrito**, listas e links.</small>
        </label>
      </section>

      <aside class="editor-sidebar">
        <section class="form-card">
          <label>
            <span>Categoria</span>
            <input name="category" maxlength="80" value="${esc(page?.category ?? 'Geral')}" list="category-options" required>
            <datalist id="category-options">${pageCategories.map((item) => `<option value="${item}">`).join('')}</datalist>
          </label>
          <label class="checkbox-label">
            <input type="checkbox" name="is_pinned" ${page?.is_pinned ? 'checked' : ''}>
            <span>Fixar esta página no início</span>
          </label>
        </section>

        <section class="form-card upload-card">
          <div class="field-title">Documentos anexos</div>
          <label class="dropzone" for="page-files">
            <span class="upload-icon">↑</span>
            <strong>Escolher arquivos</strong>
            <span>PDF, imagem, texto, Office ou ZIP</span>
            <small>Até 10 arquivos, ${maxUploadMb} MB cada</small>
          </label>
          <input class="visually-hidden" id="page-files" type="file" name="files" multiple accept="${acceptAttr}">
          <span class="file-selection" data-file-label="page-files">Nenhum arquivo selecionado</span>
          ${documents.length ? `<div class="existing-files"><strong>Anexos atuais</strong>${documents.map((item) => `
            <a href="${esc(links[item.id]?.download ?? '#')}"><span>${esc(item.title)}</span><small>${formatBytes(item.file_size)} ↓</small></a>`).join('')}</div>` : ''}
        </section>

        <div class="form-actions vertical">
          <button class="button button-primary button-block" type="submit">${page ? 'Salvar alterações' : 'Criar página'}</button>
          <a class="button button-ghost button-block" href="${back}">Cancelar</a>
        </div>
      </aside>
    </form>

    ${page ? `
      <section class="danger-zone editor-danger-zone">
        <div><strong>Excluir esta página</strong><span>A página será removida, mas seus documentos continuarão disponíveis na biblioteca.</span></div>
        <button class="button button-danger-ghost" type="button" data-action="delete-page" data-id="${page.id}"
          data-confirm="Excluir a página “${esc(page.title)}”? Os documentos anexados serão preservados.">Excluir página</button>
      </section>` : ''}`);

  bindFileLabels();
  const form = document.getElementById('page-form');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = {
      title: form.elements.title.value.trim().slice(0, 180),
      category: form.elements.category.value.trim().slice(0, 80) || 'Geral',
      content: form.elements.content.value.slice(0, 500_000),
      is_pinned: form.elements.is_pinned.checked,
    };
    const files = [...form.elements.files.files];
    if (!values.title) return;
    busy(form, true);
    try {
      validateFiles(files);
      let pageId = page?.id;
      if (page) {
        await api.update(`notes?id=${eq(page.id)}`, { ...values, updated_at: new Date().toISOString() });
      } else {
        [{ id: pageId }] = await api.insert('notes?select=id', values);
      }
      await uploadFiles(files, { category: values.category, description: `Anexo da página ${values.title}.`, noteId: pageId });
      setFlash('success', page ? 'Página atualizada.' : `Página criada${files.length ? ` com ${files.length} anexo(s)` : ''}.`);
      go(`#/pages/${pageId}`);
    } catch (error) {
      busy(form, false);
      showInlineError(error);
    }
  });
}

// ---------- documentos ----------

async function documentFormView(id) {
  const pages = await api.get('notes?select=id,title&order=title');
  let document = null;
  if (id) {
    document = await api.one('documents?select=id,title,category,description,original_name,mime_type,file_size,note_id'
      + `&id=${eq(id)}`);
    if (!document) return errorPage('Documento não encontrado', 'Esse documento não existe.', '404');
  }
  const links = document ? await fileLinks([document]) : {};

  layout('documents', document ? 'Editar documento' : 'Enviar documentos', `
    <div class="back-row"><a href="#/?section=documentos">← Voltar aos documentos</a></div>
    <section class="form-heading narrow">
      <span class="eyebrow">${document ? 'Organizar arquivo' : 'Biblioteca'}</span>
      <h1>${document ? 'Editar documento' : 'Enviar documentos'}</h1>
      <p>${document ? 'Atualize o título, a categoria ou a página relacionada.' : 'Os arquivos ficam guardados no servidor da wiki, visíveis só para você.'}</p>
    </section>

    <form class="form-card standalone-form" id="document-form">
      ${document ? `
        <div class="current-document">
          <span class="file-badge ${fileBadge(document.mime_type).className}">DOC</span>
          <div><strong>${esc(document.original_name)}</strong><small>${formatBytes(document.file_size)}</small></div>
          <a href="${esc(links[document.id]?.download ?? '#')}">Baixar ↓</a>
        </div>
        <label><span>Título</span><input name="title" maxlength="180" value="${esc(document.title)}" required></label>` : `
        <label class="dropzone large" for="document-files">
          <span class="upload-icon">↑</span>
          <strong>Selecione até 10 arquivos</strong>
          <span>PDF, imagens, texto, Office ou ZIP · máximo de ${maxUploadMb} MB por arquivo</span>
        </label>
        <input class="visually-hidden" id="document-files" type="file" name="files" multiple required accept="${acceptAttr}">
        <span class="file-selection" data-file-label="document-files">Nenhum arquivo selecionado</span>`}

      <div class="two-columns">
        <label>
          <span>Categoria</span>
          <input name="category" maxlength="80" value="${esc(document?.category ?? 'Documentos')}" list="document-categories" required>
          <datalist id="document-categories">${documentCategories.map((item) => `<option value="${item}">`).join('')}</datalist>
        </label>
        <label>
          <span>Página relacionada <small>(opcional)</small></span>
          <select name="note_id">
            <option value="">Sem página vinculada</option>
            ${pages.map((page) => `<option value="${page.id}" ${document?.note_id === page.id ? 'selected' : ''}>${esc(page.title)}</option>`).join('')}
          </select>
        </label>
      </div>
      <label>
        <span>Descrição <small>(opcional)</small></span>
        <textarea name="description" rows="4" maxlength="4000" placeholder="Uma nota para ajudar a localizar este documento depois.">${esc(document?.description)}</textarea>
      </label>
      <div class="form-actions">
        <a class="button button-ghost" href="#/?section=documentos">Cancelar</a>
        <button class="button button-primary" type="submit">${document ? 'Salvar alterações' : 'Enviar arquivos'}</button>
      </div>
    </form>

    ${document ? `
      <div class="standalone-danger">
        <button class="text-danger" type="button" data-action="delete-document" data-id="${document.id}"
          data-confirm="Remover definitivamente este arquivo?">Remover documento definitivamente</button>
      </div>` : ''}`);

  bindFileLabels();
  const form = window.document.getElementById('document-form');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = {
      category: form.elements.category.value.trim().slice(0, 80) || 'Documentos',
      description: form.elements.description.value.trim().slice(0, 4000),
      note_id: form.elements.note_id.value || null,
    };
    busy(form, true);
    try {
      if (document) {
        const title = form.elements.title.value.trim().slice(0, 180);
        if (!title) throw new Error('Informe um título para o documento.');
        await api.update(`documents?id=${eq(document.id)}`, { ...values, title, updated_at: new Date().toISOString() });
        setFlash('success', 'Documento atualizado.');
      } else {
        const files = [...form.elements.files.files];
        if (!files.length) throw new Error('Escolha pelo menos um arquivo.');
        validateFiles(files);
        await uploadFiles(files, { category: values.category, description: values.description, noteId: values.note_id });
        setFlash('success', `${files.length} documento(s) armazenado(s).`);
      }
      go('#/?section=documentos');
    } catch (error) {
      busy(form, false);
      showInlineError(error);
    }
  });
}

// ---------- contas a pagar ----------

async function billsView(query) {
  const month = parseMonth(query.get('month'));
  const [bills, payments] = await Promise.all([
    api.get('bills?select=id,name&order=name'),
    api.get(`bill_payments?select=bill_id&month=${eq(`${month}-01`)}`),
  ]);
  const paid = new Set(payments.map((item) => item.bill_id));
  const label = monthLabel(month);
  const paidCount = bills.filter((bill) => paid.has(bill.id)).length;

  layout('bills', 'Contas a pagar', `
    <section class="hero-row"><div><span class="eyebrow">Lembrete mensal</span><h1>Contas a pagar</h1></div></section>

    <nav class="month-switcher" aria-label="Escolher mês">
      <a class="icon-button" href="#/bills?month=${shiftMonth(month, -1)}" title="Mês anterior" aria-label="Mês anterior">←</a>
      <strong>${esc(label)}</strong>
      <a class="icon-button" href="#/bills?month=${shiftMonth(month, 1)}" title="Próximo mês" aria-label="Próximo mês">→</a>
      ${month !== todayIso().slice(0, 7) ? '<a class="clear-filter" href="#/bills">Mês atual</a>' : ''}
      <span class="result-count">${paidCount} de ${bills.length}</span>
      ${paidCount ? `<div class="month-reset"><button class="button button-danger-ghost" type="button" data-action="reset-bills"
        data-month="${month}" data-confirm="Zerar os checks de ${esc(label.toLowerCase())}?">↺ Zerar checks</button></div>` : ''}
    </nav>

    <div class="bill-list">
      ${bills.map((bill) => {
        const isPaid = paid.has(bill.id);
        return `
          <div class="bill-row${isPaid ? ' bill-paid' : ''}">
            <button class="bill-check" type="button" data-action="toggle-bill" data-id="${bill.id}" data-month="${month}"
              data-paid="${isPaid}" aria-pressed="${isPaid}" aria-label="${isPaid ? 'Desmarcar' : 'Marcar'} ${esc(bill.name)}">${isPaid ? '✓' : ''}</button>
            <span class="bill-name">${esc(bill.name)}</span>
            <button class="bill-remove" type="button" data-action="delete-bill" data-id="${bill.id}"
              data-confirm="Remover “${esc(bill.name)}” da lista?" title="Remover da lista" aria-label="Remover ${esc(bill.name)}">×</button>
          </div>`;
      }).join('')}
      <form class="bill-add" id="bill-form">
        <input name="name" maxlength="120" placeholder="Adicionar conta…" aria-label="Nome da nova conta" required>
        <button class="button button-primary" type="submit">Adicionar</button>
      </form>
    </div>`);

  const form = document.getElementById('bill-form');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = form.elements.name.value.trim().slice(0, 120);
    if (!name) return;
    busy(form, true);
    await runAction(async () => { await api.insert('bills', { name }, 'return=minimal'); });
    document.querySelector('#bill-form input')?.focus();
  });
}

// ---------- ações ----------

function showInlineError(error) {
  console.error(error);
  const main = app.querySelector('main.shell');
  main.querySelector('.flash')?.remove();
  main.insertAdjacentHTML('afterbegin',
    `<div class="flash flash-error" role="alert">${esc(error.message || 'Ocorreu um erro inesperado. Tente novamente.')}</div>`);
  window.scrollTo({ top: 0 });
}

// Executa a ação e recarrega a tela; se ela devolver outro endereço, vai para lá.
async function runAction(action) {
  try {
    const next = await action();
    if (next && next !== location.hash) location.hash = next;
    else await route();
  } catch (error) {
    showInlineError(error);
  }
}

const actions = {
  async 'copy-code'(button) {
    const code = button.closest('.code-block').querySelector('pre').innerText.replace(/\n$/, '');
    try {
      await copyText(code);
      button.textContent = 'Copiado ✓';
      button.classList.add('copied');
    } catch {
      button.textContent = 'Falhou';
    }
    clearTimeout(button.resetTimer);
    button.resetTimer = setTimeout(() => {
      button.textContent = 'Copiar';
      button.classList.remove('copied');
    }, 2000);
  },
  async logout() {
    api.logout();
    route();
  },
  async 'delete-page'(button) {
    await runAction(async () => {
      await api.remove(`notes?id=${eq(button.dataset.id)}`);
      setFlash('success', 'Página removida. Os documentos anexados foram preservados na biblioteca.');
      return '#/';
    });
  },
  async 'delete-document'(button) {
    await runAction(async () => {
      // O arquivo é apagado junto com o registro (ON DELETE CASCADE).
      await api.remove(`documents?id=${eq(button.dataset.id)}`);
      setFlash('success', 'Documento removido.');
      return '#/?section=documentos';
    });
  },
  async 'toggle-bill'(button) {
    const { id, month } = button.dataset;
    await runAction(async () => {
      if (button.dataset.paid === 'true') {
        await api.remove(`bill_payments?bill_id=${eq(id)}&month=${eq(`${month}-01`)}`);
      } else {
        await api.insert('bill_payments', { bill_id: id, month: `${month}-01` },
          'return=minimal,resolution=ignore-duplicates');
      }
    });
  },
  async 'delete-bill'(button) {
    await runAction(async () => { await api.remove(`bills?id=${eq(button.dataset.id)}`); });
  },
  async 'reset-bills'(button) {
    const { month } = button.dataset;
    await runAction(async () => {
      await api.remove(`bill_payments?month=${eq(`${month}-01`)}`);
      setFlash('success', `Checks de ${monthLabel(month).toLowerCase()} zerados.`);
    });
  },
};

app.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action]');
  if (!button || !actions[button.dataset.action]) return;
  event.preventDefault();
  if (button.dataset.confirm && !window.confirm(button.dataset.confirm)) return;
  button.disabled = true;
  await actions[button.dataset.action](button);
  button.disabled = false;
});

// ---------- rotas ----------

async function route() {
  if (!api.session) return loginView();
  const { path, query } = parseRoute();
  const parts = path.split('/').filter(Boolean);
  loading();
  window.scrollTo({ top: 0 });
  try {
    if (!parts.length || parts[0] === 'dashboard') return await dashboardView(query);
    if (parts[0] === 'pages' && parts[1] === 'new') return await pageFormView(null);
    if (parts[0] === 'pages' && parts[1] && parts[2] === 'edit') return await pageFormView(parts[1]);
    if (parts[0] === 'pages' && parts[1]) return await pageView(parts[1]);
    if (parts[0] === 'documents' && parts[1] === 'new') return await documentFormView(null);
    if (parts[0] === 'documents' && parts[1] && parts[2] === 'edit') return await documentFormView(parts[1]);
    if (parts[0] === 'bills') return await billsView(query);
    return errorPage('Página não encontrada', 'O endereço informado não existe.', '404');
  } catch (error) {
    console.error(error);
    if (error?.code === '22P02') return errorPage('Página não encontrada', 'O endereço informado não existe.', '404');
    return errorPage('Erro inesperado', error?.message || 'Ocorreu um erro inesperado. Tente novamente.', '500');
  }
}

window.addEventListener('hashchange', route);
route();
