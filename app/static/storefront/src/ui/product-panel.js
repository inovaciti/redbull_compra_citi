// Nome e preço do sabor escolhido, seletor de quantidade e botão "Adicionar".
// O preço segue a faixa da quantidade total do pedido (a troca é animada por
// price-swap.js); sabor sem estoque aparece como "Esgotado" e não pode ser adicionado.

import { disposables, replayClass } from '../core/dom.js';
import { formatMoney } from '../core/format.js';
import { showPrice } from './price-swap.js';

const CONFIRM_MS = 1700;

/**
 * @param {{ refs: Record<string, HTMLElement>, store: any, catalog: any[], actions: any, pricing: any, remaining: (id: string, state?: any) => number }} opts
 */
export function createProductPanel({ refs, store, catalog, actions, pricing, remaining }) {
  const d = disposables();
  const { shop, name, price, qty, qtyUp, qtyDown, add, addTotal } = refs;
  let confirmTimer = 0;

  d.listen(qtyUp, 'click', () => actions.setQuantity(store.get().quantity + 1));
  d.listen(qtyDown, 'click', () => actions.setQuantity(store.get().quantity - 1));
  d.listen(add, 'click', () => {
    if (add.disabled) return;
    actions.addSelected();
    add.classList.add('is-confirmed');
    clearTimeout(confirmTimer);
    confirmTimer = setTimeout(() => add.classList.remove('is-confirmed'), CONFIRM_MS);
  });

  function renderName(flavor) {
    name.setAttribute('aria-label', flavor.name);
    name.replaceChildren(...flavor.lines.map((text) => {
      const line = document.createElement('span');
      line.className = 'ln';
      line.setAttribute('aria-hidden', 'true');
      line.textContent = text;
      return line;
    }));
    name.style.setProperty('--L', String(flavor.lines.length));
    replayClass(name, 'is-entering');
  }

  function render(state, prev) {
    const flavor = catalog[state.selected];
    const soldOut = !(state.stock[flavor.id] > 0);
    const left = remaining(flavor.id, state);
    if (!prev || state.selected !== prev.selected) renderName(flavor);

    // preço por lata na faixa que o pedido alcança com esta quantidade; "Adicionar" mostra as latas
    // escolhidas a esse preço (o mesmo valor por lata da gaveta, nunca uma diferença entre totais)
    const count = state.cartCount + Object.values(state.inFlight).reduce((a, b) => a + b, 0);
    const unit = pricing.unitPrice(count + state.quantity);
    if (soldOut) showPrice(price, 'Esgotado', null);
    else if (unit === null) showPrice(price, 'Indisponível', null);
    else showPrice(price, formatMoney(unit), unit);
    shop.classList.toggle('is-sold-out', soldOut);

    if (!prev || state.quantity !== prev.quantity) {
      qty.textContent = String(state.quantity);
      if (prev) {
        const up = state.quantity > prev.quantity;
        qty.classList.remove(up ? 'is-down' : 'is-up');
        replayClass(qty, up ? 'is-up' : 'is-down');
      }
    }
    qtyDown.disabled = state.quantity <= 1;
    qtyUp.disabled = state.quantity >= left;
    add.disabled = left <= 0 || unit === null;
    addTotal.textContent = unit === null ? '' : formatMoney(pricing.lineTotal(unit, state.quantity));
  }

  render(store.get());
  d.add(store.subscribe(render));

  return {
    destroy() {
      clearTimeout(confirmTimer);
      d.dispose();
    },
  };
}
