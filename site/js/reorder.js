// Arrastar e soltar para reordenar os cards de páginas (mouse, toque e teclado).
// `save(ids)` recebe a nova ordem e devolve uma Promise.
export function enableReorder(grid, save) {
  const SLIDE = 220;   // duração do deslize dos cards que abrem espaço
  const EDGE = 96;     // faixa junto às bordas que dispara a rolagem automática

  const status = document.createElement('p');
  status.className = 'reorder-status';
  status.setAttribute('role', 'status');
  status.hidden = true;
  grid.parentNode.insertBefore(status, grid);

  const report = (state, message) => {
    status.dataset.state = state;
    status.textContent = message;
    status.hidden = false;
    if (state === 'saved') setTimeout(() => { status.hidden = true; }, 2600);
  };

  const cards = () => [...grid.querySelectorAll('.page-card')];
  const currentOrder = () => cards().map((item) => item.dataset.pageId);

  let card = null;      // card sendo arrastado
  let grabOffset = 0;   // distância entre o topo do card e o ponteiro
  let shift = 0;        // deslocamento atual do card em relação à sua vaga
  let pointerY = 0;
  let frame = null;
  let slideTimer = null;
  let orderOnGrab = '';
  let pending = null;

  const persist = () => {
    report('saving', 'Salvando a nova ordem…');
    save(currentOrder())
      .then(() => report('saved', 'Ordem salva.'))
      .catch(() => report('error', 'Não foi possível salvar a ordem. Recarregue o painel e tente de novo.'));
  };

  // Agrupa movimentos seguidos (arrastar em etapas, segurar a seta) num envio só.
  const schedulePersist = () => {
    clearTimeout(pending);
    pending = setTimeout(persist, 160);
  };

  // FLIP: guarda onde cada card está, reordena o DOM e anima da posição antiga
  // para a nova. `lift` exclui o card arrastado, que já segue o ponteiro.
  const moveTo = (item, before, lift) => {
    if (before === item.nextElementSibling || before === item) return;
    const moving = cards().filter((other) => !lift || other !== item);
    const from = new Map(moving.map((other) => [other, other.getBoundingClientRect().top]));

    grid.insertBefore(item, before);

    clearTimeout(slideTimer);
    moving.forEach((other) => {
      other.classList.remove('is-sliding');
      other.classList.add('no-anim');
      other.style.transform = '';
    });
    moving.forEach((other) => {
      const delta = from.get(other) - other.getBoundingClientRect().top;
      if (Math.abs(delta) > 0.5) other.style.transform = `translateY(${delta}px)`;
    });
    requestAnimationFrame(() => {
      moving.forEach((other) => {
        other.classList.remove('no-anim');
        other.classList.add('is-sliding');
        other.style.transform = '';
      });
      slideTimer = setTimeout(() => {
        moving.forEach((other) => other.classList.remove('is-sliding'));
      }, SLIDE + 40);
    });
  };

  // Rola a página sozinha quando o ponteiro encosta no topo ou no rodapé.
  const autoScroll = () => {
    const limit = window.innerHeight;
    let step = 0;
    if (pointerY < EDGE) step = -Math.ceil((EDGE - pointerY) / 3);
    else if (pointerY > limit - EDGE) step = Math.ceil((pointerY - (limit - EDGE)) / 3);
    if (step) window.scrollBy(0, step);
  };

  const follow = () => {
    const slotTop = card.getBoundingClientRect().top - shift;
    shift = pointerY - grabOffset - slotTop;
    card.style.transform = `translateY(${shift}px)`;
  };

  // offsetTop ignora transforms, então a comparação continua válida mesmo
  // com os outros cards no meio da animação.
  const settle = () => {
    const middle = card.offsetTop + shift + card.offsetHeight / 2;
    const before = cards().find((other) => other !== card && middle < other.offsetTop + other.offsetHeight / 2) || null;
    moveTo(card, before, true);
  };

  const tick = () => {
    if (!card) return;
    autoScroll();
    settle();
    follow();
    frame = requestAnimationFrame(tick);
  };

  const finish = () => {
    if (!card) return;
    const dropped = card;
    card = null;
    cancelAnimationFrame(frame);
    grid.classList.remove('is-reordering');
    document.documentElement.style.scrollBehavior = '';

    dropped.style.transition = `transform ${SLIDE}ms cubic-bezier(.2,.7,.3,1)`;
    dropped.style.transform = '';
    setTimeout(() => {
      dropped.classList.remove('is-dragging');
      dropped.style.transition = '';
    }, SLIDE);

    shift = 0;
    if (currentOrder().join() !== orderOnGrab) schedulePersist();
  };

  grid.addEventListener('pointerdown', (event) => {
    const handle = event.target.closest('.drag-handle');
    if (!handle || event.button > 0) return;
    event.preventDefault();

    card = handle.closest('.page-card');
    orderOnGrab = currentOrder().join();
    pointerY = event.clientY;
    grabOffset = event.clientY - card.getBoundingClientRect().top;
    shift = 0;

    card.classList.remove('is-sliding');
    card.style.transition = 'none';
    card.classList.add('is-dragging');
    grid.classList.add('is-reordering');
    // o scroll suave global deixaria a rolagem automática engasgada
    document.documentElement.style.scrollBehavior = 'auto';

    try { grid.setPointerCapture(event.pointerId); } catch { /* segue sem captura */ }
    frame = requestAnimationFrame(tick);
  });

  grid.addEventListener('pointermove', (event) => {
    if (card) pointerY = event.clientY;
  });

  grid.addEventListener('pointerup', finish);
  grid.addEventListener('pointercancel', finish);

  // Alternativa por teclado: com o foco na alça, Alt + setas move o card.
  grid.addEventListener('keydown', (event) => {
    const handle = event.target.closest('.drag-handle');
    if (!handle || !event.altKey) return;
    const item = handle.closest('.page-card');
    const up = event.key === 'ArrowUp';
    const down = event.key === 'ArrowDown';
    if (up && !item.previousElementSibling) return;
    if (down && !item.nextElementSibling) return;
    if (!up && !down) return;

    event.preventDefault();
    moveTo(item, up ? item.previousElementSibling : item.nextElementSibling.nextElementSibling, false);
    handle.focus();
    item.scrollIntoView({ block: 'nearest' });
    schedulePersist();
  });
}
