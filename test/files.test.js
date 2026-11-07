import assert from 'node:assert/strict';
import test from 'node:test';

import { fileBadge, formatBytes, isAccepted, searchKey, titleFromFilename } from '../site/js/files.js';

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
