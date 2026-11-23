// Gaveta do carrinho: abre de baixo para cima sobre a geladeira desfocada.
// Tem três etapas na mesma gaveta:
//   carrinho       itens com seletor de quantidade, esvazia em dois toques, "Finalizar Compra";
//                  sabor que esgotou fica apagado, fora do total, só com "tirar"
//   identificação  nome, sobrenome e e-mail; e-mail @citi.org.br tem preço de membro, os
//                  demais pagam o preço de não membro (com aviso antes de confirmar)
//   pagamento      Pix (ui/payment-page.js); enquanto a cobrança está em aberto a gaveta não
//                  fecha: o X some e só o cancelamento (em dois toques) tira a pessoa dali
// Fecha por X, Esc, toque no véu ou arrastando para baixo, e mantém o foco dentro dela.
//
// Na plataforma, por cima do pacote da identificação: nomes ganham inicial maiúscula enquanto
// são digitados, o e-mail com cara de erro de digitação recebe uma sugestão de correção e os
// campos começam com os dados lembrados do comprador (ver pdv.js).

import { disposables, replayClass, setVars, toElement } from '../core/dom.js';
import { formatMoney, formatUnits } from '../core/format.js';
import { capitalizeTyping, emailStatus, tidyName } from '../core/membership.js';
import { suggestEmail } from '../core/email-hint.js';
import { showPrice } from './price-swap.js';
import { cartLine, membershipNote, unavailableLine } from './templates.js';

const CLEAR_CONFIRM_MS = 3200;
const CLEAR_ANIMATION_MS = 560;
const NOTE_MS = 4200;
const CLOSE_DRAG_RATIO = 0.2;
const CLOSE_FLICK_SPEED = 0.7; // px/ms
const GUEST_REVEAL_MS = 1100; // pausa na digitação antes de avisar que o e-mail não é do CITi
const STEP_FOCUS_MS = 420; // espera a troca de etapa antes de mover o foco
const KEYBOARD_MIN = 80; // px: abaixo disso, a diferença do viewport não é teclado

const FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
const FIELD_NAMES = { firstName: 'Nome', lastName: 'Sobrenome', email: 'E-Mail' };
const NAME_FIELDS = ['firstName', 'lastName'];
const STEP_LABELS = { items: 'Carrinho', identify: 'Identificação', pay: 'Pagamento' };

/** "Preencha Nome, Sobrenome e E-Mail." */
const missingText = (names) => {
  const labels = names.map((name) => FIELD_NAMES[name]);
  return `Preencha ${labels.length > 1 ? `${labels.slice(0, -1).join(', ')} e ${labels.at(-1)}` : labels[0]}.`;
};

/**
 * @param {{
 *   refs: Record<string, HTMLElement>, store: any, catalog: any[], actions: any, returnFocusTo: HTMLElement,
 *   pricing: any, guestPricing: any, remaining: (id: string, state?: any) => number,
 * }} opts `pricing`/`guestPricing`: tabelas de membro e de não membro (src/pricing.js)
 */
export function createCartDrawer({ refs, store, catalog, actions, returnFocusTo, pricing, guestPricing, remaining }) {
  const d = disposables();
  const {
    app, drawer, veil, drawerHandle, clear, back, close, itemsPage, cartList, cartEmpty, cartCount, cartTotal,
    checkout, note, idForm, idMessage, idCount, idWas, idTotal, confirm, cancelPay, payPage, payAction,
  } = refs;
  const noteText = /** @type {HTMLElement} */ (note.querySelector('[data-role="text"]'));
  const form = /** @type {HTMLFormElement} */ (idForm);
  const inputs = /** @type {Record<string, HTMLInputElement>} */ ({
    firstName: form.elements.namedItem('firstName'),
    lastName: form.elements.namedItem('lastName'),
    email: form.elements.namedItem('email'),
  });
  const fieldOf = (name) => /** @type {HTMLElement} */ (inputs[name].closest('.fld'));
  const finePointer = matchMedia('(pointer: fine)');
  const nonMemberPrice = formatMoney(guestPricing.unitPrice(1) ?? 0);
  const lines = new Map(); // id → { li, gone }
  let confirmTimer = 0;
  let clearTimer = 0;
  let noteTimer = 0;
  let guestTimer = 0;
  let focusTimer = 0;

  // ── ações
  d.listen(close, 'click', () => actions.closeCart());
  d.listen(veil, 'click', () => actions.closeCart());
  d.listen(checkout, 'click', () => actions.identify());
  d.listen(back, 'click', () => actions.backToCart());
  d.listen(clear, 'click', requestClear);
  d.listen(cartList, 'click', (e) => {
    const button = e.target.closest('[data-action]');
    if (!button) return;
    const id = button.closest('[data-id]').dataset.id;
    if (button.dataset.action === 'increment') actions.incrementLine(id);
    else if (button.dataset.action === 'dismiss') actions.dismissUnavailable(id);
    else actions.decrementLine(id);
  });

  /** Há alguma linha no carrinho (a comprar ou esgotada)? */
  const hasLines = (state) => state.cartCount > 0 || state.unavailable.length > 0;

  /** Primeiro toque pede confirmação (o botão vira ✓ com anel de contagem); o segundo esvazia. */
  function requestClear() {
    const state = store.get();
    if (!hasLines(state) || state.clearing) return;
    clearTimeout(confirmTimer);
    if (!state.confirmingClear) {
      store.set({ confirmingClear: true });
      confirmTimer = setTimeout(() => store.set({ confirmingClear: false }), CLEAR_CONFIRM_MS);
      return;
    }
    store.set({ confirmingClear: false, clearing: true });
    clearTimer = setTimeout(() => {
      actions.clearCart();
      store.set({ clearing: false });
    }, CLEAR_ANIMATION_MS);
  }

  // ── identificação
  // Campos vazios só viram erro depois da primeira tentativa de confirmar. O aviso de não membro
  // (e a sugestão de correção do e-mail) só aparece quando a pessoa termina de digitar (ou sai do
  // campo), para não piscar enquanto o domínio ainda está pela metade ("joao@citi.org").
  // Dados lembrados já chegam completos: o aviso deles aparece de imediato.
  for (const [name, input] of Object.entries(inputs)) input.value = store.get().customer[name] ?? '';
  const remembered = inputs.email.value.trim().length > 0;
  let submitted = false;
  let emailTouched = remembered;
  let guestRevealed = remembered;
  let keptEmail = ''; // e-mail mantido como está mesmo com sugestão (a pessoa confirmou assim)

  const values = () => Object.fromEntries(Object.entries(inputs).map(([name, input]) => [name, input.value]));
  const filled = (name) => inputs[name].value.trim().length > 0;

  /** Correção sugerida para o e-mail digitado (se ele não for um já mantido pela pessoa). */
  function suggestion() {
    const email = inputs.email.value.trim();
    return email && email !== keptEmail && emailStatus(email) !== 'member' ? suggestEmail(email) : null;
  }

  /** Situação do e-mail como mostrada agora: o aviso de não membro (ou a sugestão) pode estar aguardando. */
  function shownStatus() {
    const status = emailStatus(inputs.email.value);
    if (suggestion()) return guestRevealed || emailTouched ? 'hint' : 'pending';
    if (status === 'guest' && !guestRevealed) return 'pending';
    if (status === 'invalid' && !emailTouched) return 'pending';
    return status;
  }

  function markField(name, { valid, invalid, member = false }) {
    const field = fieldOf(name);
    field.classList.toggle('is-valid', valid);
    field.classList.toggle('is-invalid', invalid);
    field.classList.toggle('is-member', member);
    inputs[name].setAttribute('aria-invalid', String(invalid));
  }

  let messageShown = '';
  function renderIdentity() {
    const missing = submitted ? Object.keys(inputs).filter((name) => !filled(name)) : [];
    const status = shownStatus();
    const valid = emailStatus(inputs.email.value);
    for (const name of NAME_FIELDS) markField(name, { valid: filled(name), invalid: missing.includes(name) });
    markField('email', {
      valid: status === 'member' || status === 'guest',
      invalid: missing.includes('email') || status === 'invalid' || (status === 'hint' && valid === 'invalid' && emailTouched),
      member: status === 'member',
    });

    // uma mensagem só, abaixo do e-mail; refeita só quando muda, para a entrada animar uma vez
    let kind = '';
    let text = '';
    if (missing.length) [kind, text] = ['invalid', missingText(missing)];
    else if (status === 'hint') [kind, text] = ['hint', suggestion() ?? ''];
    else if (status === 'invalid') [kind, text] = ['invalid', 'Digite Um E-Mail Válido.'];
    else if (status === 'member' || status === 'guest') kind = status;
    const key = `${kind}|${text}`;
    if (key !== messageShown) {
      messageShown = key;
      idMessage.replaceChildren(...(kind ? [toElement(membershipNote(kind, { nonMemberPrice, suggestion: text, text }))] : []));
    }
    renderTotals(status);
  }

  let totalShown = '';
  function renderTotals(status = shownStatus()) {
    const { cartCount: count } = store.get();
    // a sugestão não muda o preço: vale o do e-mail como está escrito
    const guest = status === 'guest' || (status === 'hint' && emailStatus(inputs.email.value) === 'guest');
    const total = (guest ? guestPricing : pricing).total(count);
    const memberTotal = pricing.total(count);
    idCount.textContent = `Total · ${formatUnits(count)}`;
    const text = formatMoney(total);
    if (text !== totalShown) {
      if (totalShown) replayClass(idTotal, 'is-bump');
      totalShown = text;
      idTotal.textContent = text;
    }
    const changed = Math.abs(total - memberTotal) > 0.004;
    idWas.hidden = !changed;
    idWas.textContent = changed ? formatMoney(memberTotal) : '';
  }

  /** Nome enquanto é digitado: inicial maiúscula, sem mexer no cursor. */
  function capitalize(input) {
    const typed = capitalizeTyping(input.value);
    if (typed === input.value || typed.length !== input.value.length) return;
    const { selectionStart, selectionEnd, selectionDirection } = input;
    input.value = typed;
    input.setSelectionRange(selectionStart, selectionEnd, selectionDirection ?? 'none');
  }

  /** Nome ao sair do campo: fica como vai no pedido. */
  function tidy(input) {
    const tidied = tidyName(input.value);
    if (tidied !== input.value) input.value = tidied;
  }

  function scheduleReveal() {
    clearTimeout(guestTimer);
    guestRevealed = false;
    const status = emailStatus(inputs.email.value);
    if (status === 'guest' || suggestion()) {
      guestTimer = setTimeout(() => {
        guestRevealed = true;
        renderIdentity();
      }, GUEST_REVEAL_MS);
    }
  }

  d.listen(form, 'input', (e) => {
    const input = /** @type {HTMLInputElement} */ (e.target);
    if (NAME_FIELDS.includes(input.name) && !e.isComposing) capitalize(input);
    actions.setCustomer(values());
    if (input === inputs.email) scheduleReveal();
    renderIdentity();
  });
  d.listen(form, 'compositionend', (e) => {
    const input = /** @type {HTMLInputElement} */ (e.target);
    if (!NAME_FIELDS.includes(input.name)) return;
    capitalize(input);
    actions.setCustomer(values());
  });
  d.listen(form, 'focusout', (e) => {
    const input = /** @type {HTMLInputElement} */ (e.target);
    if (NAME_FIELDS.includes(input.name)) {
      tidy(input);
      actions.setCustomer(values());
      renderIdentity();
      return;
    }
    if (input !== inputs.email || !filled('email')) return;
    emailTouched = true;
    clearTimeout(guestTimer);
    guestRevealed = true;
    renderIdentity();
  });

  // "Corrigir": aplica a sugestão e mostra na hora a situação do e-mail corrigido
  d.listen(idMessage, 'click', (e) => {
    if (!e.target.closest('[data-action="apply-suggestion"]')) return;
    const fixed = suggestion();
    if (!fixed) return;
    inputs.email.value = fixed;
    actions.setCustomer(values());
    clearTimeout(guestTimer);
    emailTouched = true;
    guestRevealed = true;
    renderIdentity();
    confirm.focus({ preventScroll: true }); // o botão "Corrigir" saiu da tela com o aviso
  });

  d.listen(form, 'submit', (e) => {
    e.preventDefault();
    if (store.get().checkingOut) return;
    // preenchimento automático nem sempre dispara "input": relê e arruma os nomes
    NAME_FIELDS.forEach((name) => tidy(inputs[name]));
    actions.setCustomer(values());

    // não membro: o preço muda, então o aviso precisa ter sido visto antes de confirmar; com a
    // sugestão de correção à vista, confirmar de novo mantém o e-mail como está
    const status = emailStatus(inputs.email.value);
    const shown = messageShown.split('|')[0];
    submitted = true;
    emailTouched = true;
    clearTimeout(guestTimer);
    guestRevealed = true;
    if (shown === 'hint' && status !== 'invalid') keptEmail = inputs.email.value.trim();
    renderIdentity();

    const invalid = Object.keys(inputs).filter((name) => !filled(name) || (name === 'email' && status === 'invalid'));
    if (invalid.length) {
      invalid.forEach((name) => replayClass(fieldOf(name), 'is-shake'));
      inputs[invalid[0]].focus({ preventScroll: true });
      return;
    }
    const now = messageShown.split('|')[0];
    if ((now === 'hint' || now === 'guest') && now !== shown) {
      replayClass(idMessage, 'is-attention');
      return;
    }
    actions.checkout();
  });

  // ── teclado: Esc fecha, Tab circula dentro da gaveta
  d.listen(document, 'keydown', (e) => {
    if (!store.get().cartOpen) return;
    if (e.key === 'Escape') {
      actions.closeCart();
      return;
    }
    if (e.key !== 'Tab') return;
    const focusables = [...drawer.querySelectorAll(FOCUSABLE)].filter((el) => !el.closest('[hidden], [inert]'));
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      last.focus();
      e.preventDefault();
    } else if (!e.shiftKey && document.activeElement === last) {
      first.focus();
      e.preventDefault();
    }
  });

  // ── teclado virtual do celular: a gaveta sobe junto e continua inteira à vista
  const viewport = window.visualViewport;
  function followKeyboard() {
    const covered = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
    drawer.style.setProperty('--kb', `${covered > KEYBOARD_MIN ? Math.round(covered) : 0}px`);
  }
  if (viewport) {
    d.listen(viewport, 'resize', followKeyboard);
    d.listen(viewport, 'scroll', followKeyboard);
  }

  // ── arrastar o topo para baixo fecha
  let drag = null;
  d.listen(drawer, 'pointerdown', (e) => {
    if (e.button > 0 || !drawerHandle.contains(e.target) || e.target.closest('button')) return;
    drag = { id: e.pointerId, y: e.clientY, dy: 0, speed: 0, t: performance.now() };
    drawer.setPointerCapture?.(e.pointerId);
    drawer.style.transition = 'none';
    veil.style.transition = 'none';
  });
  d.listen(drawer, 'pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const raw = e.clientY - drag.y;
    const dy = raw > 0 ? raw : -Math.min(14, -raw * 0.25); // resistência ao puxar para cima
    const now = performance.now();
    drag.speed = (dy - drag.dy) / Math.max(1, now - drag.t);
    drag.t = now;
    drag.dy = dy;
    drawer.style.transform = `translateY(${dy.toFixed(1)}px)`;
    veil.style.opacity = String(Math.max(0, 1 - Math.max(0, dy) / (drawer.offsetHeight * 0.9)));
  });
  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const { dy, speed } = drag;
    drag = null;
    for (const prop of ['transition', 'transform']) drawer.style.removeProperty(prop);
    for (const prop of ['transition', 'opacity']) veil.style.removeProperty(prop);
    if (dy > drawer.offsetHeight * CLOSE_DRAG_RATIO || speed > CLOSE_FLICK_SPEED) actions.closeCart();
  };
  d.listen(drawer, 'pointerup', endDrag);
  d.listen(drawer, 'pointercancel', endDrag);

  // ── render
  function renderLines(state) {
    const { cart, unavailable } = state;
    // todas as latas do pedido têm o mesmo preço: o da faixa da quantidade total
    const unitPrice = pricing.unitPrice(state.cartCount) ?? 0;
    const unit = `${formatMoney(unitPrice)} Un.`;
    const goneOf = (id) => !cart[id] && unavailable.includes(id);
    for (const [id, line] of lines) {
      // saiu do carrinho, ou mudou de tipo (esgotou / voltou a ter estoque): a linha é refeita
      if ((!cart[id] && !goneOf(id)) || line.gone !== goneOf(id)) {
        line.li.remove();
        lines.delete(id);
      }
    }
    let previous = null; // linhas seguem a ordem do catálogo; as existentes não são movidas (preserva o foco)
    for (const flavor of catalog) {
      const quantity = cart[flavor.id];
      const gone = goneOf(flavor.id);
      if (!quantity && !gone) continue;
      let line = lines.get(flavor.id);
      if (!line) {
        line = { li: toElement(gone ? unavailableLine(flavor) : cartLine(flavor)), gone };
        setVars(line.li, flavor.vars);
        lines.set(flavor.id, line);
        cartList.insertBefore(line.li, previous ? previous.nextSibling : cartList.firstChild);
      }
      const { li } = line;
      previous = li;
      if (gone) continue;
      showPrice(li.querySelector('[data-role="unit"]'), unit, unitPrice);
      li.querySelector('[data-role="qty"]').textContent = String(quantity);
      li.querySelector('[data-action="increment"]').disabled = remaining(flavor.id, state) <= 0;
      const decrement = li.querySelector('[data-action="decrement"]');
      decrement.classList.toggle('is-removal', quantity <= 1);
      decrement.setAttribute('aria-label', quantity <= 1 ? 'Remover do carrinho' : 'Remover uma');
    }
  }

  /** Troca de etapa: só o que está à vista recebe foco e toque. */
  function renderStep(step, animate) {
    const identify = step === 'identify';
    const pay = step === 'pay';
    if (!animate) {
      drawer.classList.add('is-instant'); // ao reabrir, volta ao carrinho sem animar a troca
      requestAnimationFrame(() => requestAnimationFrame(() => drawer.classList.remove('is-instant')));
    }
    drawer.classList.toggle('is-identify', identify);
    drawer.classList.toggle('is-pay', pay);
    drawer.setAttribute('aria-label', STEP_LABELS[step]);
    itemsPage.inert = step !== 'items';
    form.inert = !identify;
    payPage.inert = !pay;
    clear.tabIndex = step === 'items' ? 0 : -1;
    back.tabIndex = identify ? 0 : -1;
    cancelPay.tabIndex = pay ? 0 : -1;
    clearTimeout(focusTimer);
    if (!animate) return;
    focusTimer = setTimeout(() => {
      if (!store.get().cartOpen) return;
      if (pay) payAction.focus({ preventScroll: true });
      else if (!identify) checkout.focus({ preventScroll: true });
      else if (finePointer.matches) {
        // no computador, já no primeiro campo vazio (com tudo lembrado, em "Confirmar Pedido");
        // no celular, sem abrir o teclado sozinho
        const empty = Object.values(inputs).find((input) => !input.value.trim()) ?? confirm;
        empty.focus({ preventScroll: true });
      } else back.focus({ preventScroll: true });
    }, STEP_FOCUS_MS);
  }

  function render(state, prev) {
    const opened = state.cartOpen && !prev?.cartOpen;
    const closed = !state.cartOpen && prev?.cartOpen;
    const empty = state.cartCount === 0;
    const noLines = !hasLines(state);

    app.classList.toggle('is-cart-open', state.cartOpen);
    veil.classList.toggle('is-visible', state.cartOpen);
    drawer.classList.toggle('is-open', state.cartOpen);
    drawer.classList.toggle('is-empty', empty);
    drawer.setAttribute('aria-hidden', String(!state.cartOpen));

    if (!prev || state.cartStep !== prev.cartStep) renderStep(state.cartStep, !!prev && !opened && state.cartOpen);

    // cobrança sendo criada ou Pix em aberto: a gaveta fica presa (sem X nem voltar) até a
    // cobrança terminar ou ser cancelada
    drawer.classList.toggle('is-locked', state.checkingOut || state.payment?.status === 'pending');
    back.disabled = state.checkingOut;

    if (!prev || state.cart !== prev.cart || state.inFlight !== prev.inFlight || state.unavailable !== prev.unavailable) {
      renderLines(state);
      renderTotals();
    }
    cartList.hidden = noLines;
    cartEmpty.hidden = !noLines;
    cartList.classList.toggle('is-clearing', state.clearing);
    cartCount.textContent = `Subtotal · ${formatUnits(state.cartCount)}`;
    cartTotal.textContent = formatMoney(state.cartTotal);

    clear.disabled = noLines || state.clearing;
    clear.classList.toggle('is-confirming', state.confirmingClear);
    clear.setAttribute('aria-label', state.confirmingClear ? 'Confirmar: esvaziar o carrinho' : 'Esvaziar o carrinho');

    confirm.classList.toggle('is-busy', state.checkingOut);
    confirm.setAttribute('aria-busy', String(state.checkingOut));

    if (state.note !== prev?.note) {
      clearTimeout(noteTimer);
      note.hidden = !state.note;
      if (state.note) {
        noteText.textContent = state.note.text;
        // aviso novo com outro já à vista: a entrada anima de novo
        note.getAnimations().forEach((animation) => { animation.cancel(); animation.play(); });
        const shown = state.note;
        noteTimer = setTimeout(() => { if (store.get().note === shown) store.set({ note: null }); }, NOTE_MS);
      }
    }

    if (opened) requestAnimationFrame(() => close.focus({ preventScroll: true }));
    if (closed) {
      [confirmTimer, noteTimer, focusTimer].forEach(clearTimeout);
      if (drawer.contains(document.activeElement)) returnFocusTo.focus({ preventScroll: true });
    }
  }

  render(store.get());
  renderIdentity();
  d.add(store.subscribe(render));

  return {
    destroy() {
      [confirmTimer, clearTimer, noteTimer, guestTimer, focusTimer].forEach(clearTimeout);
      d.dispose();
    },
  };
}
