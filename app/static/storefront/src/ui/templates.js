// Marcação da loja. Sem estilos inline (compatível com CSP estrita): toda
// variável visual é aplicada depois via CSSOM. Elementos que o JavaScript
// controla são marcados com data-ref.

import { escapeHtml } from '../core/dom.js';
import { NAME_MAX } from '../core/membership.js';

const icon = {
  bag: `<svg class="bag" width="32" height="32" viewBox="0 0 30 30" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path class="bd" d="M5 11h20l-1.2 11.4a3 3 0 0 1-3 2.6H9.2a3 3 0 0 1-3-2.6L5 11z"/><path d="M11 11V9a4 4 0 0 1 8 0v2"/></svg>`,
  recenter: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4"/><circle cx="12" cy="12" r="8.2" opacity=".35"/></svg>`,
  chevronLeft: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>`,
  chevronRight: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>`,
  minus: (size = 18, width = 2.2) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" aria-hidden="true"><path d="M5.5 12h13"/></svg>`,
  plus: (size = 18, width = 2.2) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" aria-hidden="true"><path d="M12 5.5v13M5.5 12h13"/></svg>`,
  check: (size) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`,
  arrowRight: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`,
  back: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 5.5L8 12l6.5 6.5"/></svg>`,
  person: `<svg class="psn" width="32" height="32" viewBox="0 0 30 30" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle class="hd" cx="15" cy="10.6" r="4.7" pathLength="1"/><path class="sh" d="M6.4 24.6c.95-4.75 4.4-7.5 8.6-7.5s7.65 2.75 8.6 7.5" pathLength="1"/></svg>`,
  personOff: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10" cy="8.2" r="3.6"/><path d="M3.6 19.6c.75-3.7 3.3-5.8 6.4-5.8 1.2 0 2.3.3 3.2.9"/><path d="M16.2 15.2l4.4 4.4M20.6 15.2l-4.4 4.4"/></svg>`,
  personCheck: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10" cy="8.2" r="3.6"/><path d="M3.6 19.6c.75-3.7 3.3-5.8 6.4-5.8 1.2 0 2.3.3 3.2.9"/><path d="M15.6 17.4l2.2 2.2 4-4.4"/></svg>`,
  cash: `<svg class="cash" width="34" height="34" viewBox="0 0 30 30" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path class="cash-s" d="M5.6 9.8a3.4 3.4 0 0 1 3.4-3.4h15.4a3.4 3.4 0 0 1 3.4 3.4v7.6a3.4 3.4 0 0 1-3.4 3.4" pathLength="1"/><rect class="cash-s" x="2.6" y="9.6" width="21.8" height="14.4" rx="3.4" pathLength="1"/><circle class="cash-s" cx="13.5" cy="16.8" r="3.6" pathLength="1"/><g class="cash-d" fill="currentColor" stroke="none"><circle cx="6.9" cy="16.8" r="1"/><circle cx="20.1" cy="16.8" r="1"/></g></svg>`,
  copy: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8.6" y="8.6" width="11.4" height="11.4" rx="3"/><path d="M15.4 8.6V6.7A2.7 2.7 0 0 0 12.7 4H6.7A2.7 2.7 0 0 0 4 6.7v6a2.7 2.7 0 0 0 2.7 2.7h1.9"/></svg>`,
  mail: `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="13" rx="3"/><path d="M4.5 7.5l7.5 5.5 7.5-5.5"/></svg>`,
  close: `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>`,
  info: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.8v.2"/></svg>`,
  trashSmall: `<svg class="tr" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16"/><path d="M9.4 7V5.3A1.3 1.3 0 0 1 10.7 4h2.6a1.3 1.3 0 0 1 1.3 1.3V7"/><path d="M6.2 7.2l.9 11a2 2 0 0 0 2 1.8h5.8a2 2 0 0 0 2-1.8l.9-11"/></svg>`,
  trash: `<svg class="ic-t" width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><g class="lid"><path d="M4 7h16"/><path d="M9.4 7V5.3A1.3 1.3 0 0 1 10.7 4h2.6a1.3 1.3 0 0 1 1.3 1.3V7"/></g><path d="M6.2 7.2l.9 11a2 2 0 0 0 2 1.8h5.8a2 2 0 0 0 2-1.8l.9-11"/><path d="M10 11v5.4M14 11v5.4"/></svg>`,
  fridge: `<svg class="dr-in" viewBox="0 0 20.8 24.8" aria-hidden="true"><line x1="0" y1="11.6" x2="20.8" y2="11.6"/><line x1="0" y1="20.4" x2="20.8" y2="20.4"/><rect x="2.6" y="4.6" width="2.8" height="7" rx="1"/><rect x="6.8" y="4.6" width="2.8" height="7" rx="1"/><rect x="11" y="4.6" width="2.8" height="7" rx="1"/><rect x="15.2" y="4.6" width="2.8" height="7" rx="1"/><rect x="2.6" y="13.4" width="2.8" height="7" rx="1"/><rect x="6.8" y="13.4" width="2.8" height="7" rx="1"/><rect x="11" y="13.4" width="2.8" height="7" rx="1"/><rect x="15.2" y="13.4" width="2.8" height="7" rx="1"/></svg>`,
  sadFace: `<svg class="cs-face" viewBox="0 0 100 100" width="104" height="104" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><g class="fc-b" stroke-width="3.6"><path d="M24 38L39 31"/><path d="M76 38L61 31"/></g><g class="fc-eg" fill="currentColor" stroke="none"><ellipse class="fc-e" cx="36" cy="48" rx="4.8" ry="5.8"/><ellipse class="fc-e" cx="64" cy="48" rx="4.8" ry="5.8"/></g><path class="fc-m" d="M34 72Q50 58 66 72" stroke-width="3.8"/></svg>`,
};

/** Camadas de vidro líquido de um botão (lidas pelo motor em ui/liquid-glass.js). */
const glassLayers = (withGlow = true) =>
  `<i class="lg-back"></i><i class="lg-lens"></i><i class="lg-fill"></i><i class="lg-fb"></i><i class="lg-rim"></i>${withGlow ? '<i class="lg-glow"></i>' : ''}`;

const cartIcon = () => `<i class="fl"></i><i class="rg"></i><i class="rg r2"></i>${icon.bag}`;

const badge = (refName) => `<span class="badge" data-ref="${refName}" hidden><b></b></span>`;

function header(logo) {
  return `
    <div class="brand">
      <div class="logo-box"><img class="logo" src="${escapeHtml(logo.src)}" alt="${escapeHtml(logo.alt)}" draggable="false"></div>
    </div>
    <div class="fabs">
      <button type="button" class="cart-btn" data-ref="cartButton" aria-label="Abrir carrinho">
        ${cartIcon()}
        ${badge('cartBadge')}
      </button>
    </div>`;
}

function fridgeControls() {
  return `
    <div class="dfab">
      <div class="tipw">
        <button type="button" class="rc" data-ref="recenter" aria-label="Recentralizar">${icon.recenter}</button>
        <span class="tip" role="tooltip" aria-hidden="true">Recentralizar</span>
      </div>
      <div class="tipw">
        <button type="button" class="fab door" data-ref="door" aria-pressed="false" aria-label="Abrir Porta">
          <i class="tint"></i><i class="rip"></i>
          <span class="dr" aria-hidden="true">
            <i class="dr-spill"></i>
            <i class="dr-ft f1"></i><i class="dr-ft f2"></i>
            <i class="dr-box"><i class="dr-lit"></i>${icon.fridge}</i>
            <i class="dr-mist m1"></i><i class="dr-mist m2"></i><i class="dr-mist m3"></i>
            <i class="dr-leaf"><i class="dr-hd"></i></i>
          </span>
        </button>
        <span class="tip" role="tooltip" aria-hidden="true" data-ref="doorTip">Abrir Porta</span>
      </div>
    </div>`;
}

function carouselItem(flavor, index) {
  return `
    <div class="cv-it" data-index="${index}" role="option" aria-selected="false" aria-label="${escapeHtml(flavor.name)}">
      <img class="cv-img" src="${escapeHtml(flavor.image)}" alt="Lata ${escapeHtml(flavor.name)}" draggable="false" decoding="async" fetchpriority="${index === 0 ? 'high' : 'low'}">
    </div>`;
}

function shopPanel(catalog) {
  return `
    <section class="shop glass" data-ref="shop" aria-label="Escolha o sabor">
      <div class="cv" data-ref="carousel" tabindex="0" role="listbox" aria-label="Sabores. Arraste para os lados ou use as setas.">
        <i class="cv-glow"></i>
        <i class="cv-floor"></i>
        ${catalog.map(carouselItem).join('')}
        <button type="button" class="cv-arr l" data-step="-1" aria-label="Sabor anterior">${icon.chevronLeft}</button>
        <button type="button" class="cv-arr r" data-step="1" aria-label="Próximo sabor">${icon.chevronRight}</button>
      </div>
      <div class="dots" data-ref="dots" aria-hidden="true">
        ${catalog.map((_, i) => `<i data-index="${i}"></i>`).join('')}
        <b class="dots-lens"></b>
      </div>

      <div class="det">
        <svg class="svg-defs" width="0" height="0" aria-hidden="true" focusable="false"><defs><filter id="nmOutline" x="-4%" y="-12%" width="108%" height="124%" color-interpolation-filters="sRGB"><feMorphology in="SourceAlpha" operator="erode" radius="1.3" result="e"/><feComposite in="SourceGraphic" in2="e" operator="out" result="edge"/><feColorMatrix in="SourceGraphic" type="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 .1 0" result="fill"/><feMerge><feMergeNode in="fill"/><feMergeNode in="edge"/></feMerge></filter></defs></svg>
        <div class="nmw"><h1 class="name" data-ref="name"></h1></div>
        <div class="pr"><span class="price" data-ref="price"></span><span class="sub">Lata 250 ml</span></div>
      </div>

      <div class="buy" data-ref="buy">
        <div class="lg lg-step" data-lg data-refr="26" data-bz="28" data-disp="0.4" data-lift="0.15" role="group" aria-label="Quantidade">
          ${glassLayers(false)}
          <button type="button" class="stp" data-lgi data-ref="qtyDown" aria-label="Diminuir">
            <i class="stp-b" data-lg data-refr="7"><i class="lg-lens"></i><i class="lg-fill"></i><i class="lg-fb"></i><i class="lg-rim"></i><i class="lg-glow"></i></i>
            ${icon.minus()}
          </button>
          <span class="qn-w" aria-live="polite"><b class="qn" data-ref="qty">1</b></span>
          <button type="button" class="stp" data-lgi data-ref="qtyUp" aria-label="Aumentar">
            <i class="stp-b" data-lg data-refr="7"><i class="lg-lens"></i><i class="lg-fill"></i><i class="lg-fb"></i><i class="lg-rim"></i><i class="lg-glow"></i></i>
            ${icon.plus()}
          </button>
        </div>
        <button type="button" class="lg lg-add" data-lg data-lgi data-refr="34" data-bz="28" data-disp="0.5" data-lift="0.15" data-ref="add">
          ${glassLayers()}
          <span class="ad-a"><span>Adicionar</span><i class="ad-d"></i><span class="ad-p" data-ref="addTotal"></span></span>
          <span class="ad-b" aria-hidden="true">${icon.check(20)}<span>Adicionado</span></span>
        </button>
      </div>
    </section>`;
}

function toast() {
  return `
    <div class="toast glass" data-ref="toast" role="status" aria-live="polite">
      <span class="tph"><img data-ref="toastImage" alt="" draggable="false"></span>
      <span class="tt"><b data-ref="toastName"></b><em>Adicionado ao Carrinho</em></span>
    </div>`;
}

/** Campo de texto com rótulo flutuante. */
function field({ name, label, type = 'text', autocomplete, extra = '' }) {
  return `
    <label class="fld" data-field="${name}">
      <input class="fld-in" name="${name}" type="${type}" autocomplete="${autocomplete}" placeholder=" " required ${extra}>
      <span class="fld-lb">${escapeHtml(label)}</span>
      <i class="fld-ok" aria-hidden="true">${icon.check(15)}</i>
    </label>`;
}

function cartDrawer() {
  const roundGlass = 'data-lg data-lgi data-refr="13" data-bz="15" data-disp="0.3" data-lift="0.15"';
  return `
    <div class="veil" data-ref="veil"></div>
    <aside class="cart is-empty" data-ref="drawer" role="dialog" aria-modal="true" aria-label="Carrinho" aria-hidden="true" tabindex="-1" data-refr="22" data-bz="30" data-disp="0.3" data-lift="0.35">
      <i class="lg-lens"></i><i class="lg-fill"></i><i class="lg-fb"></i><i class="lg-rim"></i>
      <div class="cs-in">
        <div class="cs-top" data-ref="drawerHandle">
          <i class="cs-grab"></i>
          <div class="cs-h">
            <div class="cs-ico" data-ref="drawerIcon">
              <span class="cart-btn cs-cb" data-ref="drawerCartIcon" aria-hidden="true">${cartIcon()}${badge('drawerBadge')}</span>
              <span class="cart-btn cs-cb cs-pb" aria-hidden="true"><i class="fl"></i>${icon.person}</span>
              <span class="cart-btn cs-cb cs-pm" aria-hidden="true"><i class="fl"></i>${icon.cash}</span>
            </div>
            <div class="cs-act">
              <div class="cs-slot">
                <div class="cs-clrw">
                  <button type="button" class="lg cs-b cs-clr" ${roundGlass} data-ref="clear" aria-label="Esvaziar o carrinho" disabled>
                    ${glassLayers()}
                    <span class="cs-ic">${icon.trash}${icon.check(21).replace('<svg ', '<svg class="ic-k" ')}</span>
                  </button>
                  <span class="cs-tip" aria-hidden="true">Clique De Novo Para Esvaziar</span>
                </div>
                <button type="button" class="lg cs-b cs-bk" ${roundGlass} data-ref="back" aria-label="Voltar ao carrinho" tabindex="-1">
                  ${glassLayers()}
                  ${icon.back}
                </button>
                <div class="cs-clrw cs-cnw">
                  <button type="button" class="lg cs-b cs-clr cs-cn" ${roundGlass} data-ref="cancelPay" aria-label="Cancelar o Pix" tabindex="-1">
                    ${glassLayers()}
                    <span class="cs-ic">${icon.back.replace('<svg ', '<svg class="ic-t" ')}${icon.check(21).replace('<svg ', '<svg class="ic-k" ')}</span>
                  </button>
                  <span class="cs-tip" aria-hidden="true">Clique De Novo Para Cancelar</span>
                </div>
              </div>
              <button type="button" class="lg cs-b cs-x" ${roundGlass} data-ref="close" aria-label="Fechar carrinho">
                ${glassLayers()}
                ${icon.close}
              </button>
            </div>
          </div>
        </div>

        <div class="cs-pages">
          <div class="cs-pg cs-pg-items" data-ref="itemsPage">
            <ul class="cs-list" data-ref="cartList" hidden></ul>

            <div class="cs-empty" data-ref="cartEmpty">
              <span class="cs-eg">${icon.sadFace}</span>
              <b class="cs-et">Seu Carrinho Está Vazio</b>
            </div>

            <div class="cs-f">
              <div class="cs-tot"><span class="k" data-ref="cartCount"></span><span class="v" data-ref="cartTotal"></span></div>
              <button type="button" class="lg lg-add" data-lg data-lgi data-refr="34" data-bz="28" data-disp="0.5" data-lift="0.15" data-ref="checkout">
                ${glassLayers()}
                <span class="ad-a"><span>Finalizar Compra</span>${icon.arrowRight}</span>
              </button>
            </div>
          </div>

          <form class="cs-pg cs-pg-id" data-ref="idForm" novalidate aria-label="Identificação" inert>
            <div class="cs-fields">
              <div class="cs-row">
                ${field({ name: 'firstName', label: 'Nome', autocomplete: 'given-name', extra: `autocapitalize="words" maxlength="${NAME_MAX.firstName}"` })}
                ${field({ name: 'lastName', label: 'Sobrenome', autocomplete: 'family-name', extra: `autocapitalize="words" maxlength="${NAME_MAX.lastName}"` })}
              </div>
              ${field({ name: 'email', label: 'E-Mail', type: 'email', autocomplete: 'email', extra: 'inputmode="email" autocapitalize="off" autocorrect="off" spellcheck="false" maxlength="254" aria-describedby="storefront-membership"' })}
              <div class="cs-msg" id="storefront-membership" data-ref="idMessage" aria-live="polite"></div>
            </div>

            <div class="cs-f cs-f-id">
              <div class="cs-tot">
                <span class="k" data-ref="idCount"></span>
                <span class="v"><s class="cs-was" data-ref="idWas" hidden></s><span data-ref="idTotal"></span></span>
              </div>
              <button type="submit" class="lg lg-add cs-go" data-lg data-lgi data-refr="34" data-bz="28" data-disp="0.5" data-lift="0.15" data-ref="confirm">
                ${glassLayers()}
                <span class="ad-a"><span>Confirmar Pedido</span>${icon.arrowRight}</span>
                <span class="cs-spin" aria-hidden="true"></span>
              </button>
            </div>
          </form>

          ${paymentPage()}
        </div>

        <div class="cs-note" data-ref="note" role="status" hidden>${icon.info}<span data-role="text"></span></div>
      </div>
    </aside>`;
}

/**
 * Relógio do prazo do Pix (desenhado e movido por ui/payment-clock.js): mostrador de vidro com
 * marcas das horas, o setor do tempo que resta e dois ponteiros brancos, o dos minutos e o dos
 * segundos, que juntos leem o mesmo "mm:ss" do contador.
 */
function clockFace() {
  const marks = Array.from({ length: 12 }, (_, i) => (i % 3
    ? `<path class="pk-t" transform="rotate(${i * 30} 24 24)" d="M24 4.9v2"/>`
    : `<path class="pk-t is-major" transform="rotate(${i * 30} 24 24)" d="M24 4.4v3.4"/>`)).join('');
  return `
    <svg class="pk-svg" viewBox="0 0 48 48" width="38" height="38" fill="none" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id="pkFace" cx="50%" cy="26%" r="80%"><stop offset="0" stop-color="#fff" stop-opacity=".24"/><stop offset="1" stop-color="#fff" stop-opacity=".03"/></radialGradient>
        <linearGradient id="pkWedge" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".36"/><stop offset="1" stop-color="#fff" stop-opacity=".07"/></linearGradient>
      </defs>
      <circle cx="24" cy="24" r="22" fill="url(#pkFace)"/>
      <circle class="pk-rim" cx="24" cy="24" r="22"/>
      ${marks}
      <path class="pk-wedge" data-role="wedge" fill="url(#pkWedge)"/>
      <g class="pk-h" data-role="minute"><path class="pk-hm" d="M24 27.4V11.8"/></g>
      <g class="pk-h" data-role="second"><path class="pk-hs" d="M24 31V7"/><circle class="pk-hd" cx="24" cy="11" r="1.7"/></g>
      <circle class="pk-cap" cx="24" cy="24" r="2.7"/>
      <circle class="pk-pin" cx="24" cy="24" r="1"/>
    </svg>`;
}

/** Etapa de pagamento: QR do Pix, contagem, código copia e cola e, no fim, o resultado. */
function paymentPage() {
  return `
    <section class="cs-pg cs-pg-pay" data-ref="payPage" aria-label="Pagamento" inert>
      <div class="pq-body">
        <div class="pq-live" data-ref="payLive">
          <div class="pq">
            <div class="pq-card">
              <img class="pq-img" data-ref="payQr" alt="QR Code do Pix" width="240" height="240" decoding="async" draggable="false">
            </div>
          </div>
          <div class="pq-info">
            <div class="pq-st" data-ref="payStatus">
              <span class="pk" data-ref="payClock" aria-hidden="true">${clockFace()}</span>
              <span class="pq-tm" data-ref="payTime"></span>
              <i class="pq-sep" aria-hidden="true"></i>
              <span class="pq-sx" data-ref="payState" role="status"></span>
            </div>
            <div class="pq-cp" data-ref="payRow">
              <span class="pq-cx"><span class="pq-cl">Pix Copia e Cola</span><span class="pq-code" data-ref="payCode" translate="no"></span></span>
              <button type="button" class="pq-cb" data-ref="payCopy" aria-label="Copiar o código Pix"><span class="pq-ci">${icon.copy}${icon.check(19)}</span></button>
            </div>
          </div>
        </div>
        <div class="pqr" data-ref="payResult" aria-live="polite"></div>
      </div>
      <div class="cs-f cs-f-pay">
        <div class="cs-tot"><span class="k" data-ref="payCount"></span><span class="v" data-ref="payTotal"></span></div>
        <button type="button" class="lg lg-add cs-pa" data-lg data-lgi data-refr="34" data-bz="28" data-disp="0.5" data-lift="0.15" data-ref="payAction">
          ${glassLayers()}
          <span class="ad-a"><span data-ref="payLabel"></span><i class="pa-ic">${icon.copy}${icon.arrowRight}</i></span>
          <span class="ad-b" aria-hidden="true">${icon.check(20)}<span>Código Copiado</span></span>
        </button>
      </div>
    </section>`;
}

const RESULT_ICONS = {
  paid: '<path class="pqr-dr" d="M14.5 27.5l8 8 15-17" pathLength="1"/>',
  expired: '<path class="pqr-dr" d="M17 11h18M17 41h18M19 11c0 8.5 7 10.5 7 15s-7 6.5-7 15M33 11c0 8.5-7 10.5-7 15s7 6.5 7 15" pathLength="1"/>',
  failed: '<path class="pqr-dr" d="M18 18l16 16M34 18L18 34" pathLength="1"/>',
};

const RESULT_TEXTS = {
  paid: ['Pagamento Aprovado', 'Pode Pegar Suas Latas na Geladeira.'],
  expired: ['Tempo Esgotado', 'O Pix Expirou Sem Pagamento. Se Você Já Pagou, Procure o Time de Gente & Gestão.'],
  failed: ['Pagamento Não Concluído', 'Nada Foi Cobrado. Suas Latas Voltam Para o Carrinho.'],
  cancelled: ['Cobrança Cancelada', 'Este Pix Não Pode Mais Ser Pago. Suas Latas Voltam Para o Carrinho.'],
};

/** Tela final da cobrança (paga, expirada, com falha ou cancelada); paga lista as latas do pedido. */
export function paymentResult(status, number, items) {
  const [title, text] = RESULT_TEXTS[status];
  const tone = status === 'paid' ? 'paid' : status === 'expired' ? 'expired' : 'failed';
  return `
    <div class="pqr-in is-${tone}">
      <span class="pqr-orb"><svg class="pqr-ic" viewBox="0 0 52 52" width="52" height="52" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${RESULT_ICONS[tone]}</svg></span>
      <b class="pqr-t">${escapeHtml(title)}</b>
      <em class="pqr-s">${escapeHtml(text)}</em>
      ${status === 'paid' ? `
        <span class="pqr-li">${items.map(({ quantity, name }) => `<span><b>${quantity}×</b> ${escapeHtml(name)}</span>`).join('')}</span>
        <span class="pqr-n">Pedido <b>#${escapeHtml(number)}</b></span>` : ''}
    </div>`;
}

/**
 * Aviso abaixo do e-mail: membro do CITi, não membro (com o preço), sugestão de correção do
 * e-mail (`hint`, com o botão que aplica a correção) ou o que falta corrigir.
 */
export function membershipNote(status, { nonMemberPrice, suggestion, text = 'Digite Um E-Mail Válido.' }) {
  if (status === 'member') {
    return `
      <div class="cs-mbr">
        <span class="cs-mi">${icon.personCheck}</span>
        <span class="cs-mt"><b>Membro do CITi</b><em>Preço de Membro Aplicado</em></span>
      </div>`;
  }
  if (status === 'guest') {
    return `
      <div class="cs-gst">
        <span class="cs-gi">${icon.personOff}</span>
        <span class="cs-gt"><b>Você Não é Um Membro do CITi</b><em>Para Quem Não é Membro, Cada Lata Sai Por ${escapeHtml(nonMemberPrice)}.</em></span>
      </div>`;
  }
  if (status === 'hint') {
    return `
      <div class="cs-hnt">
        <span class="cs-hi">${icon.mail}</span>
        <span class="cs-ht"><b>Você Quis Dizer</b> <em>${escapeHtml(suggestion)}</em></span>
        <button type="button" class="cs-hb" data-action="apply-suggestion">Corrigir</button>
      </div>`;
  }
  return `<div class="cs-inv">${icon.info}<span>${escapeHtml(text)}</span></div>`;
}

/** Linha do carrinho de um sabor que esgotou: apagada, fora do total, só com "tirar". */
export function unavailableLine(flavor) {
  return `
    <li class="cs-it is-gone" data-id="${escapeHtml(flavor.id)}">
      <span class="cs-ph"><img src="${escapeHtml(flavor.image)}" alt="" draggable="false"></span>
      <div class="cs-inf"><div class="cs-nm">${escapeHtml(flavor.name)}</div><div class="cs-un">Esgotado</div></div>
      <div class="cs-step">
        <button type="button" class="cs-sb is-removal" data-action="dismiss" aria-label="Tirar ${escapeHtml(flavor.name)} do carrinho">${icon.trashSmall}</button>
      </div>
    </li>`;
}

/** Linha do carrinho (um sabor). */
export function cartLine(flavor) {
  return `
    <li class="cs-it" data-id="${escapeHtml(flavor.id)}">
      <span class="cs-ph"><img src="${escapeHtml(flavor.image)}" alt="" draggable="false"></span>
      <div class="cs-inf"><div class="cs-nm">${escapeHtml(flavor.name)}</div><div class="cs-un" data-role="unit"></div></div>
      <div class="cs-step" role="group" aria-label="Quantidade de ${escapeHtml(flavor.name)}">
        <button type="button" class="cs-sb" data-action="decrement">
          <svg class="mi" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M5.5 12h13"/></svg>
          ${icon.trashSmall}
        </button>
        <span class="cs-q" data-role="qty"></span>
        <button type="button" class="cs-sb" data-action="increment" aria-label="Adicionar uma">${icon.plus(15)}</button>
      </div>
    </li>`;
}

/** Página completa da loja. */
export function storefront({ catalog, logo }) {
  return `
    <div class="app" data-ref="app">
      <div class="stage-bg"></div>
      <div class="cw"><canvas data-ref="canvas" aria-label="Geladeira 3D. Arraste para girar, toque na porta para abrir e toque numa lata para escolher o sabor."></canvas></div>
      ${header(logo)}
      <div class="dock" data-ref="dock">
        ${fridgeControls()}
        ${shopPanel(catalog)}
      </div>
      ${toast()}
      ${cartDrawer()}
    </div>`;
}
