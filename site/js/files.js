// Funções sobre arquivos; usadas no navegador e nos testes.

export const maxUploadMb = 10;

export const acceptedExtensions = [
  '.csv', '.doc', '.docx', '.gif', '.jpeg', '.jpg', '.md', '.odt', '.pdf', '.png',
  '.ppt', '.pptx', '.txt', '.webp', '.xls', '.xlsx', '.zip',
];

export function extensionOf(filename) {
  const match = /\.[^./\\]+$/.exec(String(filename));
  return match ? match[0].toLowerCase() : '';
}

export function isAccepted(filename) {
  return acceptedExtensions.includes(extensionOf(filename));
}

// Conteúdo do arquivo em base64, para enviar no JSON da API.
export function readBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(new Error(`Não foi possível ler “${file.name}”.`));
    reader.readAsDataURL(file);
  });
}

export function titleFromFilename(filename) {
  const base = String(filename).replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
  return base.replace(/[_-]+/g, ' ').replace(/(^|\s)\S/g, (letter) => letter.toUpperCase()).trim();
}

export function formatBytes(value) {
  const bytes = Number(value);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

export function fileBadge(mimeType) {
  if (mimeType === 'application/pdf') return { label: 'PDF', className: 'file-pdf' };
  if (String(mimeType).startsWith('image/')) return { label: 'IMG', className: 'file-image' };
  return { label: 'DOC', className: '' };
}

// Busca sem diferenciar maiúsculas nem acentos.
export function searchKey(...parts) {
  return parts.join(' ').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
