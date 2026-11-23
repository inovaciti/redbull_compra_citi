// Troca de preço com transição: quando o valor muda por causa da quantidade, o
// preço anterior é riscado e sai, e o novo entra no lugar. Quem desenha é o CSS
// (price-swap.css); aqui só se decide se a troca merece transição.

import { replayClass } from '../core/dom.js';

/**
 * Mostra `text` em `el` e, se o valor numérico mudou em relação ao exibido
 * antes, anima a troca: queda de preço risca o anterior; aumento só o dissolve.
 * Sem valor (esgotado, indisponível) ou na primeira exibição, apenas troca o texto.
 *
 * @param {HTMLElement} el contêiner do preço (recebe a classe `px`)
 * @param {string} text texto já formatado
 * @param {number | null} value valor numérico, ou null quando não há preço
 */
export function showPrice(el, text, value) {
  let now = /** @type {HTMLElement | null} */ (el.firstElementChild);
  if (!now) {
    now = document.createElement('span');
    now.className = 'px-now';
    el.classList.add('px');
    el.append(now);
  }
  if (now.textContent === text) return;

  const before = el.dataset.value === undefined ? null : Number(el.dataset.value);
  el.classList.remove('is-cut', 'is-rise');
  if (before !== null && value !== null && before !== value) {
    el.dataset.was = now.textContent ?? '';
    replayClass(el, value < before ? 'is-cut' : 'is-rise');
  }

  now.textContent = text;
  if (value === null) delete el.dataset.value;
  else el.dataset.value = String(value);
}
