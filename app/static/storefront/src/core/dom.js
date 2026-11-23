/** Escapa texto para interpolação segura em HTML. */
export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Converte uma string HTML em elemento (primeiro nó). */
export function toElement(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html.trim();
  return /** @type {HTMLElement} */ (tpl.content.firstElementChild);
}

/**
 * Busca um elemento pelo atributo data-ref dentro de root.
 * Falha cedo se a marcação não tiver o elemento esperado.
 */
export function ref(root, name) {
  const el = root.querySelector(`[data-ref="${name}"]`);
  if (!el) throw new Error(`Elemento [data-ref="${name}"] não encontrado`);
  return /** @type {HTMLElement} */ (el);
}

/**
 * Define variáveis CSS via CSSOM (permitido pela CSP, ao contrário de style="").
 * @param {HTMLElement} el
 * @param {Record<string, string | number>} vars
 */
export function setVars(el, vars) {
  for (const [name, value] of Object.entries(vars)) el.style.setProperty(name, String(value));
}

/**
 * Reinicia uma animação CSS ligada a uma classe, mesmo que ela já esteja aplicada.
 * @param {Element} el
 * @param {string} className
 */
export function replayClass(el, className) {
  el.classList.remove(className);
  void (/** @type {HTMLElement} */ (el)).offsetWidth; // força o recálculo para a animação recomeçar
  el.classList.add(className);
}

export const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Agrupa funções de limpeza e executa todas de uma vez. */
export function disposables() {
  const fns = [];
  return {
    add(fn) {
      fns.push(fn);
      return fn;
    },
    listen(target, type, handler, options) {
      target.addEventListener(type, handler, options);
      fns.push(() => target.removeEventListener(type, handler, options));
    },
    dispose() {
      while (fns.length) fns.pop()();
    },
  };
}
