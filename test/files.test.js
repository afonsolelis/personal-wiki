import assert from 'node:assert/strict';
import test from 'node:test';

import { fileBadge, formatBytes, isAccepted, searchKey, storageKey, titleFromFilename } from '../site/js/files.js';

test('storageKey remove acentos e caracteres que o Storage recusa', () => {
  assert.equal(storageKey('abc', 'Certidão de Nascimento (2ª via).pdf'), 'abc/Certidao_de_Nascimento_2_via_.pdf');
  assert.equal(storageKey('abc', '###'), 'abc/arquivo');
});

test('isAccepted aceita só as extensões permitidas', () => {
  assert.equal(isAccepted('foto.JPG'), true);
  assert.equal(isAccepted('pagina.html'), false);
  assert.equal(isAccepted('sem-extensao'), false);
});

test('titleFromFilename gera um título legível', () => {
  assert.equal(titleFromFilename('contrato_de-aluguel.pdf'), 'Contrato De Aluguel');
});

test('formatBytes e fileBadge', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(2048), '2.0 KB');
  assert.equal(fileBadge('application/pdf').label, 'PDF');
  assert.equal(fileBadge('image/png').label, 'IMG');
  assert.equal(fileBadge('text/plain').label, 'DOC');
});

test('searchKey ignora maiúsculas e acentos', () => {
  assert.ok(searchKey('Formação Acadêmica').includes(searchKey('formacao')));
});
