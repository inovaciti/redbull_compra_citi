// Ponto de entrada público da loja.
//
// Na plataforma quem monta a loja é `pdv.js`, com catálogo, estoque, faixas
// de preço e pagamento (src/checkout-api.js) ligados à API.
//
// A gaveta tem três etapas: carrinho → identificação → pagamento (Pix). Com o Pix
// em andamento a gaveta só sai cancelando; quando a cobrança termina, "Concluir"
// (paga) esvazia o carrinho e as demais saídas devolvem as latas ao carrinho,
// conferidas com o estoque atual.
//
// Eventos (CustomEvent no elemento raiz, para integrar sem tocar no código):
//   storefront:cartchange     detail = pedido atual
//   storefront:checkout       detail = pedido, com o comprador, no clique em "Confirmar Pedido"
//   storefront:checkouterror  detail = { order, error } quando a cobrança não pôde ser criada

import { createStore } from './core/store.js';
import { disposables, ref } from './core/dom.js';
import { glowColor, splitNameLines } from './core/format.js';
import { emailStatus, tidyName } from './core/membership.js';
import { isTerminal, watchPayment } from './core/payment-watch.js';
import { storefront as storefrontMarkup } from './ui/templates.js';
import { liquidGlass } from './ui/liquid-glass.js';
import { createCarousel } from './ui/carousel.js';
import { createProductPanel } from './ui/product-panel.js';
import { createCartButton } from './ui/cart-button.js';
import { createFridgeControls } from './ui/fridge-controls.js';
import { createToast } from './ui/toast.js';
import { createCartDrawer } from './ui/cart-drawer.js';
import { createPaymentPage } from './ui/payment-page.js';
import { fridgeLayoutRect } from './scene/cooler-frame.js';

// Limite por sabor num pedido (OrderItemInput.quantity no back-end aceita de 1 a 20).
const MAX_PER_FLAVOR = 20;
const DESKTOP_MIN_WIDTH = 1024;

const DEFAULT_LOGO = {
  src: new URL('../assets/images/brand/citi-red-bull-logo.webp', import.meta.url).href,
  alt: 'CITi',
};

/** Acrescenta ao catálogo os dados derivados que a interface usa. */
function prepareCatalog(catalog) {
  return catalog.map((flavor, index) => ({
    ...flavor,
    index,
    lines: splitNameLines(flavor.name),
    // variáveis CSS do sabor: cores da lata, brilho do contorno e degradê do nome
    vars: {
      '--c': flavor.can.body,
      '--a': flavor.can.accent,
      '--d': flavor.can.deep,
      '--g': glowColor(flavor.can.body),
      '--k1': flavor.gradient[0],
      '--k2': flavor.gradient[1],
      '--k3': flavor.gradient[2],
    },
  }));
}

function cartSummary(cart, pricing) {
  const count = Object.values(cart).reduce((sum, quantity) => sum + quantity, 0);
  return { cartCount: count, cartTotal: pricing.total(count) };
}

/**
 * Monta a loja dentro de `root`.
 *
 * @param {HTMLElement} root
 * @param {{
 *   catalog: Flavor[],
 *   pricing: Pricing,
 *   guestPricing: Pricing,
 *   payment: PaymentApi,
 *   customer?: { firstName?: string, lastName?: string, email?: string },
 *   logo?: { src: string, alt: string },
 *   ledColor?: string,
 *   fridge?: { power?: number | { led?: number, interior?: number }, startView?: 'home' | 'front', condensationVeil?: number, hold?: boolean, after?: Promise<unknown>, quality?: import('./device-tier.js').SceneTier },
 * }} options
 *
 * `pricing` / `guestPricing`: tabelas de membro (e-mail @citi.org.br) e de não membro. Até o
 * comprador se identificar, a loja mostra a de membro.
 *
 * `payment`: cria, consulta e cancela a cobrança Pix e lê o estoque atual (na plataforma,
 * src/checkout-api.js). Falhas chegam como erro com `reason` ('stock', 'invalid', 'conflict',
 * 'provider' ou 'network').
 *
 * `customer`: dados lembrados do comprador, que já chegam preenchidos na identificação.
 *
 * `fridge`: estado inicial da geladeira 3D. O loading (src/boot.js) a monta apagada e de
 * frente ({ power: 0, startView: 'front' }) e a acende quando a imagem sai da frente.
 * `fridge.quality` (src/device-tier.js): 'full', 'low' (nível leve do motor) ou 'none' (sem 3D).

 *
 * @typedef {{ unitPrice: (count: number) => number | null, lineTotal: (unit: number, count: number) => number, total: (count: number) => number }} Pricing
 * @typedef {{ id: string, name: string, stock: number, model: string | null, image: string, can: { body: string, deep: string, accent: string }, gradient: string[] }} Flavor
 * @typedef {{ firstName: string, lastName: string, email: string, member: boolean }} Customer
 * @typedef {{ items: { id: string, name: string, quantity: number, unitPrice: number, subtotal: number }[], total: number, currency: 'BRL', customer?: Customer }} Order
 * @typedef {'pending' | 'paid' | 'expired' | 'failed' | 'cancelled'} ChargeStatus
 * @typedef {{ id: string, number: string, status: ChargeStatus, qr: string, code: string, expiresAt: number | null, total: number, count: number, items: { id: string, quantity: number }[] }} Charge
 * @typedef {{
 *   create: (order: Order) => Promise<Charge>,
 *   status: (charge: Charge) => Promise<Charge>,
 *   cancel: (charge: Charge) => Promise<Charge>,
 *   stock: () => Promise<Record<string, number>>,
 * }} PaymentApi
 */
export function mountStorefront(root, options) {
  const catalog = prepareCatalog(options.catalog);
  if (!catalog.length) throw new Error('mountStorefront: catálogo vazio');
  const { pricing, guestPricing, payment: paymentApi } = options;
  if (!paymentApi) throw new Error('mountStorefront: options.payment é obrigatório');

  root.innerHTML = storefrontMarkup({ catalog, logo: options.logo ?? DEFAULT_LOGO });

  const names = ['app', 'canvas', 'cartButton', 'cartBadge', 'dock', 'shop', 'carousel', 'dots', 'name', 'price', 'buy',
    'qty', 'qtyUp', 'qtyDown', 'add', 'addTotal', 'door', 'doorTip', 'recenter', 'toast', 'toastImage', 'toastName',
    'veil', 'drawer', 'drawerHandle', 'drawerIcon', 'drawerCartIcon', 'drawerBadge', 'clear', 'back', 'close',
    'itemsPage', 'cartList', 'cartEmpty', 'cartCount', 'cartTotal', 'checkout', 'note', 'idForm', 'idMessage', 'idCount',
    'idWas', 'idTotal', 'confirm', 'cancelPay', 'payPage', 'payLive', 'payQr', 'payStatus', 'payClock', 'payTime', 'payState',
    'payCode', 'payRow', 'payCopy', 'payResult', 'payCount', 'payTotal', 'payAction', 'payLabel'];
  const refs = Object.fromEntries(names.map((n) => [n, ref(root, n)]));

  const d = disposables();
  let destroyed = false;
  const store = createStore({
    selected: 0,
    quantity: 1,
    cart: /** @type {Record<string, number>} */ ({}),
    // estoque disponível por sabor (o do servidor, já sem reservas); relido depois de cada cobrança
    stock: /** @type {Record<string, number>} */ (Object.fromEntries(catalog.map((f) => [f.id, f.stock]))),
    // sabores que estavam no carrinho e esgotaram: aparecem apagados, fora do total
    unavailable: /** @type {string[]} */ ([]),
    // latas que já saíram da geladeira e ainda não chegaram ao carrinho (contam contra o estoque)
    inFlight: /** @type {Record<string, number>} */ ({}),
    cartCount: 0,
    cartTotal: 0,
    cartOpen: false,
    cartStep: /** @type {'items' | 'identify' | 'pay'} */ ('items'),
    customer: {
      firstName: options.customer?.firstName ?? '',
      lastName: options.customer?.lastName ?? '',
      email: options.customer?.email ?? '',
    },
    checkingOut: false, // criando a cobrança
    payment: /** @type {Charge | null} */ (null), // cobrança da etapa de pagamento
    paymentTrouble: false, // a consulta da cobrança está falhando (segue tentando)
    confirmingCancel: false,
    cancelling: false,
    note: /** @type {{ text: string, key: number } | null} */ (null), // aviso flutuante da gaveta
    cartPulse: 0, // incrementa a cada lata que chega ao carrinho (dispara animação e aviso)
    lastAdded: null,
    confirmingClear: false,
    clearing: false,
    doorOpen: false,
    doorWasOpened: false,
  });

  /** @type {Awaited<ReturnType<typeof import('./scene/cooler-scene.js').mountCoolerScene>> | null} */
  let scene = null;

  // ── estoque
  /** Quantas latas do sabor ainda podem entrar no pedido (estoque disponível e limite por sabor). */
  function remaining(id, state = store.get()) {
    const taken = (state.cart[id] || 0) + (state.inFlight[id] || 0);
    return Math.max(0, Math.min(MAX_PER_FLAVOR, state.stock[id] ?? 0) - taken);
  }

  /** Latas de cada sabor que ainda estão na geladeira (estoque − carrinho − em voo), na ordem do catálogo. */
  function coolerStock(state = store.get()) {
    return catalog.map((f) => Math.max(0, (state.stock[f.id] ?? 0) - (state.cart[f.id] || 0) - (state.inFlight[f.id] || 0)));
  }

  /** Aviso flutuante da gaveta (o mesmo texto repetido aparece de novo). */
  function notify(text) {
    store.set({ note: { text, key: (store.get().note?.key ?? 0) + 1 } });
  }

  /**
   * Estoque novo do servidor: o carrinho passa a caber nele. Sabor com menos latas tem a
   * quantidade reduzida; sabor esgotado sai do total e fica apagado no carrinho.
   * @returns {string} o que mudou no carrinho, para avisar ('' se nada)
   */
  function applyStock(fresh) {
    const { cart, unavailable } = store.get();
    const stock = Object.fromEntries(catalog.map((f) => [f.id, Math.max(0, fresh[f.id] ?? 0)]));
    const next = {};
    const gone = [];
    const cut = [];
    for (const flavor of catalog) {
      const quantity = cart[flavor.id];
      if (!quantity) continue;
      const max = Math.min(MAX_PER_FLAVOR, stock[flavor.id]);
      if (max <= 0) gone.push(flavor);
      else if ((next[flavor.id] = Math.min(quantity, max)) < quantity) cut.push(flavor);
    }
    const changed = gone.length + cut.length > 0;
    updateCart(changed ? next : cart, { stock, unavailable: [...unavailable, ...gone.map((f) => f.id).filter((id) => !unavailable.includes(id))] });
    if (!changed) return '';
    if (gone.length + cut.length > 1) return 'O Estoque Mudou. Seu Carrinho Foi Ajustado.';
    if (gone.length) return `${gone[0].name} Esgotou.`;
    const left = next[cut[0].id];
    return `Só ${left === 1 ? 'Resta 1 Lata' : `Restam ${left} Latas`} de ${cut[0].name}.`;
  }

  /** Relê o estoque; sem resposta, segue com o atual (o servidor recusa o que não houver, com 409). */
  async function refreshStock() {
    try {
      const fresh = await paymentApi.stock();
      return destroyed ? '' : applyStock(fresh);
    } catch {
      return '';
    }
  }

  // ── pedido: com o comprador identificado, leva os dados dele e a tabela de membro ou de não
  // membro (só exibição: o back-end recalcula tudo pela própria tabela e pelo e-mail)
  function order() {
    const { cart, cartCount, customer } = store.get();
    const status = emailStatus(customer.email);
    const table = status === 'guest' ? guestPricing : pricing;
    const unitPrice = table.unitPrice(cartCount) ?? 0;
    const items = catalog
      .filter((f) => cart[f.id])
      .map((f) => ({ id: f.id, name: f.name, quantity: cart[f.id], unitPrice, subtotal: table.lineTotal(unitPrice, cart[f.id]) }));
    /** @type {Order} */
    const result = { items, total: table.total(cartCount), currency: 'BRL' };
    if (status === 'member' || status === 'guest') {
      result.customer = {
        firstName: tidyName(customer.firstName),
        lastName: tidyName(customer.lastName),
        email: customer.email.trim().toLowerCase(),
        member: status === 'member',
      };
    }
    return result;
  }

  function updateCart(nextCart, extra = {}) {
    store.set({ cart: nextCart, ...cartSummary(nextCart, pricing), ...extra });
    root.dispatchEvent(new CustomEvent('storefront:cartchange', { detail: order() }));
  }

  /** Soma `count` unidades do sabor `index`; `announce` toca a animação do ícone e o aviso. */
  function addToCart(index, count, announce, extra = {}) {
    const { id } = catalog[index];
    const { cart, cartPulse, unavailable } = store.get();
    const next = { ...cart, [id]: (cart[id] || 0) + count };
    if (next[id] <= 0) delete next[id];
    updateCart(next, {
      ...(announce && count > 0 ? { cartPulse: cartPulse + 1, lastAdded: index } : {}),
      // voltou a ter estoque e entrou de novo: deixa de aparecer apagado
      ...(count > 0 && unavailable.includes(id) ? { unavailable: unavailable.filter((x) => x !== id) } : {}),
      ...extra,
    });
  }

  /** Lata que terminou o voo: sai de "em voo" e entra no carrinho. */
  function land(index) {
    const { id } = catalog[index];
    const { inFlight } = store.get();
    const pending = { ...inFlight, [id]: Math.max(0, (inFlight[id] || 0) - 1) };
    if (!pending[id]) delete pending[id];
    addToCart(index, 1, true, { inFlight: pending });
  }

  /**
   * Retira latas da geladeira: cada unidade voa até o carrinho e só entra no
   * pedido ao chegar (evento "landed" da cena). O que não houver na geladeira,
   * ou se a cena 3D não estiver disponível, entra direto. Nunca passa do estoque.
   */
  function dispense(index, requested) {
    const { id } = catalog[index];
    const count = Math.min(requested, remaining(id));
    if (count <= 0) return;
    if (scene?.dispense) {
      const rest = scene.dispense(index, count);
      const flying = count - rest;
      if (flying > 0) {
        const { inFlight } = store.get();
        store.set({ inFlight: { ...inFlight, [id]: (inFlight[id] || 0) + flying } });
      }
      if (rest > 0) addToCart(index, rest, false);
    } else {
      addToCart(index, count, true);
    }
  }

  // ── cobrança Pix: acompanhada até terminar; a consulta é refeita na hora quando a pessoa volta
  // do app do banco (a página volta a ficar visível)
  /** @type {ReturnType<typeof watchPayment> | null} */
  let watch = null;

  function startPayment(charge) {
    watch?.stop();
    watch = null;
    store.set({ payment: charge, paymentTrouble: false, confirmingCancel: false, cartStep: 'pay' });
    if (isTerminal(charge.status)) return;
    watch = watchPayment({
      check: () => paymentApi.status(charge),
      onUpdate: showCharge,
      onTrouble: (failing) => store.set({ paymentTrouble: failing }),
    });
  }

  /** Nova situação da cobrança à vista (a contagem continua pelo prazo da primeira resposta). */
  function showCharge(charge) {
    const { payment } = store.get();
    if (!payment || payment.id !== charge.id || payment.status === charge.status) return;
    store.set({ payment: { ...charge, expiresAt: payment.expiresAt }, confirmingCancel: false, ...(isTerminal(charge.status) ? { paymentTrouble: false } : {}) });
  }

  /**
   * Sai da etapa de pagamento. Paga: o pedido acabou e o carrinho esvazia. Nos outros casos
   * as latas voltam ao carrinho, conferidas com o estoque atual (a reserva já foi liberada).
   * `close`: fecha a gaveta junto (a etapa só volta ao carrinho na próxima abertura, sem a
   * troca de página aparecer enquanto a gaveta desce).
   * @returns {Promise<string>} o que o estoque novo mudou no carrinho ('' se nada)
   */
  async function leavePayment({ close }) {
    const paid = store.get().payment?.status === 'paid';
    watch?.stop();
    watch = null;
    store.set({
      payment: null,
      paymentTrouble: false,
      confirmingCancel: false,
      ...(close ? { cartOpen: false, note: null } : { cartStep: 'items' }),
    });
    if (paid) updateCart({}, { unavailable: [] });
    const changed = await refreshStock();
    return paid ? '' : changed;
  }

  d.listen(document, 'visibilitychange', () => {
    if (document.visibilityState === 'visible') watch?.now();
  });

  const actions = {
    select(index) {
      if (index !== store.get().selected) store.set({ selected: index, quantity: 1 });
    },
    setQuantity(n) {
      const max = Math.max(1, remaining(catalog[store.get().selected].id));
      store.set({ quantity: Math.max(1, Math.min(max, n)) });
    },
    addSelected() {
      const { selected, quantity } = store.get();
      dispense(selected, quantity);
      store.set({ quantity: 1 });
    },
    incrementLine(id) {
      dispense(catalog.findIndex((f) => f.id === id), 1);
    },
    decrementLine(id) {
      addToCart(catalog.findIndex((f) => f.id === id), -1, false);
    },
    clearCart() {
      updateCart({}, { unavailable: [] });
    },
    /** Tira do carrinho um sabor que esgotou. */
    dismissUnavailable(id) {
      store.set({ unavailable: store.get().unavailable.filter((x) => x !== id) });
    },
    openCart() {
      store.set({ cartOpen: true, cartStep: 'items', confirmingClear: false });
    },
    closeCart() {
      const { payment, checkingOut } = store.get();
      // cobrança sendo criada ou Pix em aberto: só sai cancelando (ou quando a cobrança terminar)
      if (checkingOut || (payment && !isTerminal(payment.status))) return;
      if (payment) leavePayment({ close: true });
      else store.set({ cartOpen: false, note: null, confirmingClear: false });
    },
    /** "Finalizar Compra": passa para a identificação do comprador. */
    identify() {
      if (!store.get().cartCount) return;
      store.set({ cartStep: 'identify', confirmingClear: false });
    },
    backToCart() {
      if (!store.get().checkingOut) store.set({ cartStep: 'items' }); // a cobrança sai deste carrinho
    },
    setCustomer(customer) {
      store.set({ customer: { ...store.get().customer, ...customer } });
    },
    /** "Confirmar Pedido" (com o comprador já validado pela gaveta): cria a cobrança Pix. */
    async checkout() {
      const current = order();
      const { checkingOut, payment } = store.get();
      if (!current.items.length || !current.customer || checkingOut || payment) return;
      root.dispatchEvent(new CustomEvent('storefront:checkout', { detail: current }));
      store.set({ checkingOut: true, note: null }); // evita pedido duplicado por clique repetido
      try {
        const charge = await paymentApi.create(current);
        if (!destroyed) startPayment(charge);
      } catch (error) {
        if (destroyed) return;
        root.dispatchEvent(new CustomEvent('storefront:checkouterror', { detail: { order: current, error } }));
        if (error?.reason === 'stock') {
          // alguém levou as latas antes: o carrinho se ajusta ao estoque e a pessoa revê o pedido
          const changed = await refreshStock();
          store.set({ cartStep: 'items' });
          notify(changed || 'O Estoque Mudou. Confira Seu Carrinho.');
        } else {
          if (!error?.reason) console.error('[storefront] falha ao criar a cobrança:', error);
          // os campos ficam como estão: é só tentar de novo
          notify(error?.reason === 'invalid' ? 'Confira Nome e E-Mail e Tente De Novo.' : 'Não Foi Possível Gerar o Pix. Tente De Novo.');
        }
      } finally {
        if (!destroyed) store.set({ checkingOut: false });
      }
    },
    /** Cancela o Pix em andamento; as latas voltam ao carrinho. */
    async cancelPayment() {
      const { payment, cancelling } = store.get();
      if (!payment || isTerminal(payment.status) || cancelling) return;
      store.set({ cancelling: true, confirmingCancel: false });
      try {
        const charge = await paymentApi.cancel(payment);
        if (destroyed) return;
        if (charge.status === 'cancelled') {
          const changed = await leavePayment({ close: false });
          notify(changed || 'Pix Cancelado. Suas Latas Continuam no Carrinho.');
        } else {
          showCharge(charge);
        }
      } catch (error) {
        if (destroyed) return;
        // a cobrança mudou antes do cancelamento (paga ou expirada): a consulta mostra como ficou
        if (error?.reason === 'conflict') watch?.now();
        else notify('Não Foi Possível Cancelar. Tente De Novo.');
      } finally {
        if (!destroyed) store.set({ cancelling: false });
      }
    },
    /** A contagem chegou a zero (ou a pessoa pediu): consulta a cobrança agora. */
    checkPayment() {
      watch?.now();
    },
    /** Saída das telas finais: "Concluir" (paga) fecha a gaveta; as outras voltam ao carrinho. */
    async finishPayment() {
      const { payment } = store.get();
      if (!payment || !isTerminal(payment.status)) return;
      const changed = await leavePayment({ close: payment.status === 'paid' });
      if (changed && !destroyed) notify(changed);
    },
    notify,
    setConfirmingCancel(on) {
      store.set({ confirmingCancel: on });
    },
    toggleDoor() {
      scene?.toggleDoor?.();
    },
    recenter() {
      scene?.recenter?.();
    },
  };

  // ── variáveis visuais do sabor escolhido (herdadas por nome, carrossel, botões e gaveta)
  const applyFlavorVars = (state, prev) => {
    if (prev && state.selected === prev.selected) return;
    for (const [name, value] of Object.entries(catalog[state.selected].vars)) refs.app.style.setProperty(name, value);
  };
  applyFlavorVars(store.get());
  d.add(store.subscribe(applyFlavorVars));
  // largura do nome: baseada no nome mais longo do catálogo, para o tamanho não variar entre sabores
  refs.name.style.setProperty('--n', (Math.max(...catalog.flatMap((f) => f.lines.map((l) => l.length))) * 0.8).toFixed(2));

  // ── componentes
  const carousel = createCarousel({ el: refs.carousel, dots: refs.dots, count: catalog.length, onSelect: actions.select });
  d.add(store.subscribe((s, p) => { if (s.selected !== p.selected) carousel.markSelected(s.selected); }));

  // ── esgotado no carrossel: segue o estoque (que muda depois de cada cobrança)
  const carouselItems = /** @type {HTMLElement[]} */ ([...refs.carousel.querySelectorAll('.cv-it')]);
  const renderSoldOut = (state, prev) => {
    if (prev && state.stock === prev.stock) return;
    catalog.forEach((flavor, i) => {
      const soldOut = !(state.stock[flavor.id] > 0);
      carouselItems[i].classList.toggle('is-sold-out', soldOut);
      carouselItems[i].setAttribute('aria-label', soldOut ? `${flavor.name} (esgotado)` : flavor.name);
    });
  };
  renderSoldOut(store.get());
  d.add(store.subscribe(renderSoldOut));

  const parts = [
    carousel,
    createProductPanel({ refs, store, catalog, actions, pricing, remaining }),
    createCartButton({
      button: /** @type {HTMLButtonElement} */ (refs.cartButton),
      icons: [{ el: refs.cartButton, badge: refs.cartBadge }, { el: refs.drawerCartIcon, badge: refs.drawerBadge }],
      store,
      onOpen: actions.openCart,
    }),
    createFridgeControls({ refs, store, actions }),
    createToast({ refs, store, catalog }),
    createCartDrawer({ refs, store, catalog, actions, pricing, guestPricing, remaining, returnFocusTo: refs.cartButton }),
    createPaymentPage({ refs, store, catalog, actions }),
  ];

  // ── vidro líquido nos botões de compra e na gaveta
  const glass = liquidGlass();
  for (const scope of [refs.buy, refs.drawer]) {
    if (scope.hasAttribute('data-refr')) d.add(glass.surface(scope, scope));
    scope.querySelectorAll('[data-lg]').forEach((el) => d.add(glass.surface(el, scope)));
    scope.querySelectorAll('[data-lgi]').forEach((el) => d.add(glass.interact(el)));
  }

  // ── cena 3D: carregada sob demanda, para a interface não esperar o código 3D (Three.js, GSAP)
  // área livre para a geladeira: no desktop o painel ocupa a direita; no celular, a parte de baixo
  const insets = (w) => {
    if (w >= DESKTOP_MIN_WIDTH) {
      const panel = refs.shop.getBoundingClientRect().width || Math.min(640, Math.max(480, w * 0.38));
      return { l: 24, r: Math.round(panel + 66 + Math.min(200, Math.max(40, (w - 1000) * 0.45))), t: 84, b: 104 };
    }
    // celular deitado (landscape.css): o painel fica à direita da geladeira, não embaixo
    const dock = refs.dock.getBoundingClientRect();
    if (dock.left > w * 0.3) return { l: 12, r: Math.round(w - dock.left + 12), t: 56, b: 12 };
    return { l: 0, r: 64, t: 70, b: refs.shop.getBoundingClientRect().height + 18 };
  };
  // Os downloads da geladeira começam já; a montagem (CPU pesada) espera `fridge.after`, que o
  // loading resolve quando a interface pousa: nada disputa a thread principal com a animação.
  const quality = options.fridge?.quality ?? 'full';
  const loadScene = () => {
    const sceneModule = import('./scene/cooler-scene.js');
    sceneModule.then(({ prefetchCoolerScene }) => prefetchCoolerScene({ flavors: catalog.map((f) => ({ model: f.model })), stock: coolerStock() })).catch(() => {});
    return Promise.all([sceneModule, options.fridge?.after]).then(([{ mountCoolerScene }]) => mountCoolerScene(/** @type {HTMLCanvasElement} */ (refs.canvas), {
      flavors: catalog.map((f) => ({ model: f.model })),
      stock: coolerStock(),
      ledColor: options.ledColor ?? '#1f5bff',
      power: options.fridge?.power,
      startView: options.fridge?.startView,
      condensationVeil: options.fridge?.condensationVeil,
      hold: options.fridge?.hold,
      quality: quality === 'low' ? 'low' : undefined,
      insets,
      // carrinho aberto: geladeira de frente, centrada no espaço acima da gaveta
      insetsFocus: (w, h) => {
        const drawerHeight = refs.drawer.getBoundingClientRect().height || h * 0.5;
        const desktop = w >= DESKTOP_MIN_WIDTH;
        const gap = desktop ? 24 : 10;
        const top = desktop ? 48 : 36;
        const perspective = desktop ? 8 : 6;
        // gaveta da altura toda (celular deitado): a geladeira fica atrás dela, só centralizada
        if (drawerHeight > h * 0.75) return { l: 0, r: 0, t: top, b: top };
        return { l: 0, r: 0, t: top, b: drawerHeight + gap + top + 2 * perspective };
      },
      // destino do voo da lata: ícone do topo ou, com a gaveta aberta, o ícone dentro dela
      cartPoint: () => {
        const target = store.get().cartOpen ? refs.drawerIcon : refs.cartButton;
        const r = target.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      },
    })).then((api) => {
      if (destroyed) {
        api.dispose?.();
        return null;
      }
      if (api.failed) return null; // sem WebGL: a loja funciona normalmente, só sem a geladeira 3D
      scene = api;
      api.on('landed', land);
      // tocar numa lata dentro da geladeira escolhe o sabor no carrossel
      api.on('pick', (index) => carousel.goTo(index));
      api.on('door', (open) => store.set({ doorOpen: open, doorWasOpened: store.get().doorWasOpened || open }));
      api.setStock(coolerStock());
      api.select(store.get().selected);
      api.focus(store.get().cartOpen);
      d.add(store.subscribe((s, p) => {
        if (s.cart !== p.cart || s.inFlight !== p.inFlight || s.stock !== p.stock) api.setStock(coolerStock(s));
        if (s.selected !== p.selected) api.select(s.selected);
        if (s.cartOpen !== p.cartOpen) api.focus(s.cartOpen);
      }));
      const resize = new ResizeObserver(() => api.relayout());
      resize.observe(refs.shop);
      // a gaveta muda de altura a cada etapa: a geladeira acompanha acima dela
      const drawerResize = new ResizeObserver(() => { if (store.get().cartOpen) api.relayout(); });
      drawerResize.observe(refs.drawer);
      d.add(() => drawerResize.disconnect());
      d.add(() => resize.disconnect());
      return api;
    }).catch((error) => {
      console.error('[storefront] cena 3D indisponível:', error);
      return null;
    });
  };
  // 'none' (aparelho que não aguenta 3D, ver src/device-tier.js): nada da cena é baixado; fica a
  // imagem da geladeira do loading e os botões de porta e recentralizar somem (classe no-3d)
  const sceneReady = (quality === 'none' ? Promise.resolve(null) : loadScene()).then((api) => {
    refs.app.classList.toggle('no-3d', !api);
    return api;
  });

  // interface pronta para ser vista: fontes, foto do sabor escolhido e um quadro de layout.
  // Na plataforma, espera também as transições do painel que mudam o layout ao montar (a
  // altura do nome do sabor): é desse layout final que sai o lugar onde a geladeira pousa.
  const selectedImage = /** @type {HTMLImageElement | null} */ (refs.carousel.querySelector(`.cv-it[data-index="${store.get().selected}"] img`));
  const settled = () => Promise.all(refs.dock.getAnimations({ subtree: true })
    .filter((a) => a instanceof CSSTransition)
    .map((a) => a.finished.catch(() => {})));
  const interfaceReady = Promise.all([
    document.fonts?.ready,
    selectedImage?.decode().catch(() => {}),
  ]).then(settled).then(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

  return {
    /** Resolve quando a geladeira 3D termina de carregar (ou null se indisponível). */
    ready: sceneReady,
    /** Resolve quando a interface já pode aparecer (fontes e foto do sabor prontas). */
    interfaceReady,
    /** Onde a geladeira aparece de frente na tela, sem depender do 3D carregado. */
    fridgeLayoutRect() {
      const rect = refs.canvas.getBoundingClientRect();
      return fridgeLayoutRect(rect, insets(rect.width, rect.height));
    },
    /** Remove a loja e libera todos os recursos (WebGL, listeners, timers). */
    destroy() {
      destroyed = true;
      watch?.stop();
      parts.forEach((p) => p.destroy());
      d.dispose();
      scene?.dispose();
      scene = null;
      root.replaceChildren();
    },
  };
}
