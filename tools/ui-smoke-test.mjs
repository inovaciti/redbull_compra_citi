// Teste de interface da loja: sobe o app (uvicorn) e abre "/" num Chromium real,
// com a CSP de produção, numa matriz de tamanhos de tela (celular em pé e
// deitado, tablet, notebook, desktop e telas grandes).
//
// A API (/api/products, /api/price-tiers, /api/comprador e a de pedidos/Pix) é
// respondida pelo próprio teste, com dados controlados, para o resultado não
// depender do banco nem do provedor de pagamento.
//
// Falha se houver erro de JavaScript, violação de CSP, recurso não encontrado,
// rolagem horizontal, controle fora da tela, preço/estoque errados, falha na
// identificação do comprador (validação, avisos, sugestão de e-mail, lembrança)
// ou no pagamento (QR, contagem, cancelar, pago, expirado, estoque que mudou,
// falhas ao criar a cobrança).
//
// Pré-requisito: .venv com as dependências, npm install, npx playwright install chromium
// Uso: npm run test:ui

import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { LOCAL_SERVER_ENV } from './local-server-env.mjs';

const PORT = 8765;
const BASE = `http://127.0.0.1:${PORT}/`;

const VIEWPORTS = [
  { width: 320, height: 568, label: 'celular pequeno' },
  { width: 360, height: 640, label: 'android' },
  { width: 390, height: 844, label: 'iphone' },
  { width: 430, height: 932, label: 'celular grande' },
  { width: 844, height: 390, label: 'celular deitado' },
  { width: 768, height: 1024, label: 'tablet em pé' },
  { width: 1024, height: 768, label: 'tablet deitado' },
  { width: 1280, height: 800, label: 'notebook' },
  { width: 1440, height: 900, label: 'desktop' },
  { width: 1920, height: 1080, label: 'full hd' },
  { width: 2560, height: 1440, label: '2k' },
];

// Ordem esperada na loja: a de FLAVOR_VISUALS; o ID desconhecido vai para o fim.
const PRODUCTS = [
  ['edicao_especial', 'Edição Especial', 5],
  ['acai', 'Açaí', 0],
  ['tropical', 'Tropical', 3],
  ['original', 'Energy Original', 30],
  ['tradicional_sugarfree', 'Sugarfree', 30],
  ['zero_tradicional', 'Zero', 30],
  ['melancia', 'Melancia', 30],
  ['morango_e_pessego', 'Morango e Pêssego', 30],
  ['melao_e_maracuja', 'Melão e Maracujá', 30],
  ['maca_sugarfree', 'Maçã Sugarfree', 30],
  ['nectarina_sugarfree', 'Nectarina Sugarfree', 30],
  ['pomelo_sugarfree', 'Pomelo Sugarfree', 30],
  ['amora_sugarfree', 'Amora Sugarfree', 30],
].map(([id, name, stock]) => ({ id, name, stock, category: 'Regular' }));
const INDEX = { original: 0, tropical: 4, acai: 5, edicao_especial: 12 };

const TIERS = {
  MEMBER: [
    { pricing_audience: 'MEMBER', min_quantity: 1, max_quantity: 1, unit_price: 8.5 },
    { pricing_audience: 'MEMBER', min_quantity: 2, max_quantity: 3, unit_price: 8.0 },
    { pricing_audience: 'MEMBER', min_quantity: 4, max_quantity: null, unit_price: 7.5 },
  ],
  NON_MEMBER: [{ pricing_audience: 'NON_MEMBER', min_quantity: 1, max_quantity: null, unit_price: 12.0 }],
};

// Controles que precisam estar inteiros dentro da tela e com área de toque mínima.
const CONTROLS = ['cartButton', 'qtyDown', 'qtyUp', 'add'];
const MIN_TARGET = 40;

const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}api/health`)).ok) return;
    } catch { /* ainda subindo */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('uvicorn não respondeu');
}

const QR_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 29 29"><rect width="29" height="29" fill="#fff"/><path d="M4 4h7v7H4zM18 4h7v7h-7zM4 18h7v7H4zM14 14h3v3h-3zM19 19h4v4h-4z"/></svg>';
const PIX_CODE = '00020126580014br.gov.bcb.pix0136a1b2c3d4-0000-4000-8000-000000000000520400005303986540530.005802BR5913RED BULL CITI6008RECIFE62070503***6304ABCD';

/**
 * API de pedidos de mentira, com o mesmo formato da real (app/models.py: Order). O teste muda
 * a situação de cada pedido (`orders`), o estoque (`stock`) e a resposta da criação (`createStatus`).
 */
function fakeOrders() {
  const api = { orders: new Map(), created: [], createStatus: 201, stock: Object.fromEntries(PRODUCTS.map((p) => [p.id, p.stock])) };
  let seq = 0;
  const price = (email, count) => {
    const tiers = email.endsWith('@citi.org.br') ? TIERS.MEMBER : TIERS.NON_MEMBER;
    const tier = tiers.find((t) => count >= t.min_quantity && (t.max_quantity === null || count <= t.max_quantity));
    return tier.unit_price;
  };
  api.create = (body) => {
    seq += 1;
    const id = `${String(seq).padStart(8, 'a')}-1111-4111-8111-111111111111`;
    const count = body.items.reduce((sum, item) => sum + item.quantity, 0);
    const unit = price(body.payer_email, count);
    const order = {
      id,
      buyer_name: body.buyer_name,
      items: body.items.map((item) => ({ product_id: item.product_id, product_name: item.product_id, quantity: item.quantity, unit_price: unit, subtotal: unit * item.quantity })),
      total: unit * count,
      status: 'PENDING',
      pricing_audience: body.payer_email.endsWith('@citi.org.br') ? 'MEMBER' : 'NON_MEMBER',
      created_at: new Date().toISOString(),
      paid_at: null,
      payment: { txid: `TX${seq}`, qr_code: `/api/orders/${id}/qr`, copy_paste: PIX_CODE, status: 'WAITING_PAYMENT', expires_at: new Date(Date.now() + 600000).toISOString() },
    };
    api.orders.set(id, order);
    api.created.push(body);
    return order;
  };
  api.set = (id, status, paymentStatus) => Object.assign(api.orders.get(id), { status }).payment.status = paymentStatus;
  api.last = () => [...api.orders.values()].at(-1);
  return api;
}

async function routeOrders(page, api) {
  await page.route('**/api/orders', (route) => {
    if (api.createStatus !== 201) return route.fulfill({ status: api.createStatus, json: { detail: 'falha' } });
    return route.fulfill({ status: 201, json: api.create(route.request().postDataJSON()) });
  });
  await page.route('**/api/orders/*', (route) => route.fulfill({ json: api.orders.get(route.request().url().split('/').at(-1)) }));
  await page.route('**/api/orders/*/qr', (route) => route.fulfill({ body: QR_SVG, contentType: 'image/svg+xml' }));
  await page.route('**/api/orders/*/cancel', (route) => {
    const id = route.request().url().split('/').at(-2);
    api.set(id, 'CANCELLED', 'CANCELLED');
    return route.fulfill({ json: api.orders.get(id) });
  });
}

async function openStore(browser, viewport, { productsStatus = 200, buyer = null, path = '' } = {}) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1, hasTouch: viewport.width < 1024 });
  const label = `${viewport.width}×${viewport.height} (${viewport.label})`;
  const errors = [];
  page.on('pageerror', (e) => errors.push(`${label}: erro de JS — ${e.message}`));
  // respostas de erro da API são cenários do próprio teste (409, 502…), não falhas da página
  page.on('console', (m) => { if (m.type() === 'error' && !m.location().url?.includes('/api/')) errors.push(`${label}: console — ${m.text()}`); });
  page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('/api/')) errors.push(`${label}: HTTP ${r.status()} ${r.url()}`); });
  await page.addInitScript(() => {
    window.__violations = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__violations.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  const api = fakeOrders();
  await page.route('**/api/products', (route) => (productsStatus === 200
    ? route.fulfill({ json: PRODUCTS.map((p) => ({ ...p, stock: api.stock[p.id] })) })
    : route.fulfill({ status: productsStatus, json: { detail: 'falha' } })));
  await routeOrders(page, api);
  await page.route('**/api/price-tiers?*', (route) => {
    const audience = new URL(route.request().url()).searchParams.get('pricing_audience');
    return route.fulfill({ json: TIERS[audience] ?? [] });
  });
  const remembered = []; // corpos dos PUT /api/comprador
  await page.route('**/api/comprador', (route) => {
    if (route.request().method() === 'PUT') {
      remembered.push(route.request().postDataJSON());
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({ json: buyer });
  });
  const requested = []; // tudo o que a página pediu (para saber se algo da geladeira 3D foi baixado)
  page.on('request', (r) => requested.push(r.url()));
  await page.goto(BASE + path);
  return { page, label, errors, remembered, api, requested };
}

const text = (page, ref) => page.$eval(`[data-ref="${ref}"]`, (el) => el.textContent.replace(/ /g, ' ').trim());
const flavorName = (page) => page.$eval('[data-ref="name"]', (el) => el.getAttribute('aria-label'));

async function goToFlavor(page, index) {
  await page.$eval(`.dots i[data-index="${index}"]`, (dot) => dot.click());
  await page.waitForTimeout(700);
}

async function checkLayout(page, label) {
  const layout = await page.evaluate((refs) => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const boxes = Object.fromEntries(refs.map((ref) => {
      const r = document.querySelector(`[data-ref="${ref}"]`).getBoundingClientRect();
      return [ref, { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }];
    }));
    return { w, h, scrollW: document.documentElement.scrollWidth, scrollH: document.documentElement.scrollHeight, boxes };
  }, [...CONTROLS, 'name', 'price', 'carousel']);

  check(layout.scrollW <= layout.w, `${label}: rolagem horizontal (${layout.scrollW}px > ${layout.w}px)`);
  check(layout.scrollH <= layout.h + 1, `${label}: página rola na vertical (${layout.scrollH}px > ${layout.h}px)`);
  for (const [ref, box] of Object.entries(layout.boxes)) {
    const inside = box.l >= -1 && box.t >= -1 && box.r <= layout.w + 1 && box.b <= layout.h + 1 && box.w > 0 && box.h > 0;
    check(inside, `${label}: "${ref}" fora da tela (${Math.round(box.l)},${Math.round(box.t)} → ${Math.round(box.r)},${Math.round(box.b)})`);
  }
  for (const ref of CONTROLS) {
    const box = layout.boxes[ref];
    check(Math.min(box.w, box.h) >= MIN_TARGET, `${label}: "${ref}" pequeno demais para toque (${Math.round(box.w)}×${Math.round(box.h)})`);
  }
  // sobreposição entre o nome do sabor e os controles de compra
  // (.name tem margin -12px / padding 12px para o brilho não ser cortado)
  const raw = layout.boxes.name;
  const name = { l: raw.l + 12, t: raw.t + 12, r: raw.r - 12, b: raw.b - 12 };
  const add = layout.boxes.add;
  check(name.b <= add.t + 1 || name.t >= add.b - 1 || name.r <= add.l || name.l >= add.r,
    `${label}: nome do sabor sobrepõe o botão "Adicionar"`);
}

async function checkFlow(page, label, api) {
  await page.waitForSelector('.cv-it.is-selected');
  check((await page.$$('.cv-it')).length === PRODUCTS.length, `${label}: carrossel deveria ter ${PRODUCTS.length} sabores`);
  check(await flavorName(page) === 'Original', `${label}: sabor inicial deveria ser Original (sem "Energy")`);
  check(await text(page, 'price') === 'R$ 8,50', `${label}: 1 lata deveria custar R$ 8,50`);

  // faixas de membro: 2 = 16,00; 4 = 30,00
  await page.click('[data-ref="qtyUp"]');
  check(await text(page, 'addTotal') === 'R$ 16,00', `${label}: 2 latas deveriam custar R$ 16,00`);
  check(await text(page, 'price') === 'R$ 8,00', `${label}: preço por lata com 2 deveria ser R$ 8,00`);
  // queda de preço risca o valor anterior; a volta ao preço cheio só o dissolve
  const swap = (cls, was) => page.$eval('[data-ref="price"]', (el, [c, w]) => el.classList.contains(c) && el.dataset.was.replace(/\u00a0/g, ' ') === w, [cls, was]);
  check(await swap('is-cut', 'R$ 8,50'), `${label}: ao cair para R$ 8,00 o preço antigo deveria ser riscado`);
  await page.click('[data-ref="qtyDown"]');
  check(await text(page, 'price') === 'R$ 8,50' && await swap('is-rise', 'R$ 8,00'), `${label}: de volta a 1 lata o preço deveria subir para R$ 8,50 sem riscado`);
  await page.click('[data-ref="qtyUp"]');
  await page.click('[data-ref="add"]');
  check(await text(page, 'cartBadge') === '2', `${label}: carrinho deveria mostrar 2`);
  await page.click('[data-ref="qtyUp"]');
  // com 2 no carrinho, mais 2 levam o pedido à faixa de 4: o botão mostra 2 × R$ 7,50, o mesmo
  // preço por lata da gaveta (nunca a diferença entre totais, que pareceria um preço solto)
  check(await text(page, 'price') === 'R$ 7,50', `${label}: indo a 4 latas o preço por lata deveria ser R$ 7,50`);
  check(await text(page, 'addTotal') === 'R$ 15,00', `${label}: 2 latas a R$ 7,50 deveriam mostrar R$ 15,00`);
  await page.click('[data-ref="add"]');

  await page.click('[data-ref="cartButton"]');
  await page.waitForTimeout(1200); // a gaveta leva ~0,9 s para subir (transição de .cart.is-open)
  check(await page.$eval('[data-ref="drawer"]', (el) => el.classList.contains('is-open')), `${label}: gaveta deveria abrir`);
  check(await text(page, 'cartTotal') === 'R$ 30,00', `${label}: 4 latas deveriam custar R$ 30,00`);
  check((await page.$eval('.cs-un', (el) => el.textContent.replace(/ /g, ' '))) === 'R$ 7,50 Un.', `${label}: preço unitário com 4 latas deveria ser R$ 7,50`);
  const drawer = await page.$eval('[data-ref="checkout"]', (el) => {
    const r = el.getBoundingClientRect();
    return r.bottom <= window.innerHeight + 1 && r.top >= 0 && r.right <= window.innerWidth + 1;
  });
  check(drawer, `${label}: "Finalizar Compra" fora da tela com a gaveta aberta`);
  await checkIdentify(page, label, api);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(350);

  // estoque: Tropical tem 3 em estoque
  await goToFlavor(page, INDEX.tropical);
  check(await flavorName(page) === 'Tropical', `${label}: o ponto ${INDEX.tropical} deveria levar à Tropical`);
  for (let i = 0; i < 5; i++) await page.$eval('[data-ref="qtyUp"]', (b) => b.click());
  check(await text(page, 'qty') === '3', `${label}: Tropical não deveria passar do estoque (3)`);
  check(await page.$eval('[data-ref="qtyUp"]', (b) => b.disabled), `${label}: "+" deveria travar no limite do estoque`);

  // esgotado: Açaí tem 0
  await goToFlavor(page, INDEX.acai);
  check(await text(page, 'price') === 'Esgotado', `${label}: Açaí deveria aparecer como Esgotado`);
  check(await page.$eval('[data-ref="add"]', (b) => b.disabled), `${label}: "Adicionar" deveria estar desabilitado no esgotado`);

  // produto sem visual cadastrado aparece no fim, com o visual padrão
  await goToFlavor(page, INDEX.edicao_especial);
  check(await flavorName(page) === 'Edição Especial', `${label}: produto desconhecido deveria aparecer no fim`);
}

const message = (page) => page.$eval('[data-ref="idMessage"]', (el) => el.textContent.replace(/\s+/g, ' ').trim());
const value = (page, name) => page.$eval(`[name="${name}"]`, (el) => el.value);

/** Espera a gaveta terminar de animar (com a máquina carregada, um tempo fixo não basta). */
async function settleDrawer(page) {
  await page.waitForTimeout(100);
  await page.$eval('[data-ref="drawer"]', (el) => Promise.all(el.getAnimations({ subtree: true })
    .filter((a) => a.effect?.getTiming().iterations !== Infinity)
    .map((a) => a.finished.catch(() => {}))));
}

/** Digita no campo como uma pessoa (tecla por tecla), a partir do campo vazio. */
async function typeInto(page, name, typed) {
  await page.fill(`[name="${name}"]`, '');
  await page.type(`[name="${name}"]`, typed);
}

const drawerHas = (page, cls) => page.$eval('[data-ref="drawer"]', (el, c) => el.classList.contains(c), cls);
const note = (page) => page.$eval('[data-ref="note"]', (el) => (el.hidden ? '' : el.textContent.replace(/\s+/g, ' ').trim()));
const inView = (page, selector) => page.$eval(selector, (el) => {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.top >= -1 && r.left >= -1 && r.bottom <= window.innerHeight + 1 && r.right <= window.innerWidth + 1;
});
const where = (page, selector) => page.$eval(selector, (el) => {
  const r = el.getBoundingClientRect();
  return `${Math.round(r.left)},${Math.round(r.top)} → ${Math.round(r.right)},${Math.round(r.bottom)}`;
});

/** Pix à vista: QR carregado, contagem correndo, tudo dentro da tela e a gaveta presa. */
async function checkPixShown(page, label, total) {
  await page.waitForSelector('.pq-card.is-ready', { timeout: 5000 }).catch(() => failures.push(`${label}: o QR do Pix não carregou`));
  await settleDrawer(page);
  check(await drawerHas(page, 'is-pay') && await drawerHas(page, 'is-locked'), `${label}: "Confirmar Pedido" deveria levar ao Pix (com a gaveta presa)`);
  check(/^(09:5\d|10:00)$/.test(await text(page, 'payTime')), `${label}: a contagem deveria começar em ~10:00 (veio "${await text(page, 'payTime')}")`);
  check(await text(page, 'payState') === 'Aguardando Pagamento', `${label}: o Pix deveria estar "Aguardando Pagamento"`);
  check(await text(page, 'payTotal') === total, `${label}: o Pix deveria cobrar ${total} (veio ${await text(page, 'payTotal')})`);
  check(await text(page, 'payCode') === PIX_CODE, `${label}: o código copia e cola deveria ser o da cobrança`);
  for (const selector of ['.pq', '[data-ref="payStatus"]', '[data-ref="payRow"]', '[data-ref="payAction"]', '[data-ref="cancelPay"]']) {
    check(await inView(page, selector), `${label}: "${selector}" fora da tela no Pix (${await where(page, selector)})`);
  }
  // sem efeito de leitura no QR nem bolinha na situação; o relógio lê o mesmo mm:ss dos dígitos
  check((await page.$$('.pq-scan, .pq-dot, .pq-arc')).length === 0, `${label}: o Pix não deveria ter efeito de leitura, bolinha nem anel`);
  const hands = () => page.$eval('[data-ref="payClock"]', (el) => ['minute', 'second'].map((role) => Number(/rotate\((-?[\d.]+)/.exec(el.querySelector(`[data-role="${role}"]`).getAttribute('transform'))[1])));
  const [minuteBefore, secondBefore] = await hands();
  check(Math.abs(minuteBefore - 60) <= 3, `${label}: com ~10 minutos o ponteiro dos minutos deveria apontar ~60° (veio ${minuteBefore}°)`);
  check((await page.$eval('[data-role="wedge"]', (el) => el.getAttribute('d'))).startsWith('M24 24V'), `${label}: o relógio deveria mostrar o setor do tempo que resta`);
  // o ponteiro dos segundos dá um passo de 6° por segundo, para trás, com repique: amostrado
  // várias vezes dentro de um segundo ele salta (repique) e fica parado entre os tiques
  const samples = [];
  for (let i = 0; i < 24; i++) {
    samples.push((await hands())[1]);
    await page.waitForTimeout(60);
  }
  const jumps = samples.slice(1).filter((angle, i) => Math.abs(angle - samples[i]) > 0.5).length;
  const walked = (samples[0] - samples.at(-1) + 360) % 360; // os ponteiros andam para trás: é uma contagem regressiva
  check(jumps >= 2 && jumps < samples.length - 1, `${label}: o ponteiro dos segundos deveria saltar e parar entre os tiques (mexeu em ${jumps} de ${samples.length - 1} quadros)`);
  check(walked > 2 && walked < 90, `${label}: o ponteiro dos segundos deveria andar para trás (andou ${walked.toFixed(1)}°)`);
  check(secondBefore !== samples.at(-1), `${label}: o ponteiro dos segundos não saiu do lugar`);
  const qr = await page.$eval('.pq', (el) => el.getBoundingClientRect().width);
  check(qr >= 118, `${label}: QR pequeno demais para ler (${Math.round(qr)}px)`);
  check(!(await page.$eval('[data-ref="close"]', (el) => el.checkVisibility({ visibilityProperty: true }))), `${label}: com o Pix em aberto o X deveria sumir`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  check(await drawerHas(page, 'is-open'), `${label}: Esc não deveria fechar a gaveta com o Pix em aberto`);
}

/** Cancelar o Pix em dois toques: as latas voltam ao carrinho. */
async function cancelPix(page) {
  await page.click('[data-ref="cancelPay"]');
  await page.click('[data-ref="cancelPay"]');
  await page.waitForFunction(() => !document.querySelector('[data-ref="drawer"]').classList.contains('is-pay'), null, { timeout: 5000 });
  await settleDrawer(page);
}

/** Identificação: entra pela gaveta, valida, avisa, sugere correção e envia o pedido com o comprador. */
async function checkIdentify(page, label, api) {
  await page.evaluate(() => {
    window.__checkouts = [];
    document.getElementById('storefront').addEventListener('storefront:checkout', (e) => window.__checkouts.push(e.detail));
  });
  await page.click('[data-ref="checkout"]');
  await settleDrawer(page); // troca de etapa (0,7 s) e altura nova da gaveta (0,6 s)
  check(await page.$eval('[data-ref="drawer"]', (el) => el.classList.contains('is-identify') && el.querySelector('[data-ref="itemsPage"]').inert),
    `${label}: "Finalizar Compra" deveria levar à identificação (com o carrinho inerte)`);
  const inside = await page.evaluate(() => ['firstName', 'lastName', 'email'].map((n) => document.querySelector(`[name="${n}"]`))
    .concat(document.querySelector('[data-ref="confirm"]'))
    .every((el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight + 1 && r.left >= 0 && r.right <= window.innerWidth + 1; }));
  check(inside, `${label}: campos ou "Confirmar Pedido" fora da tela na identificação`);

  // vazio → erro, sem enviar
  await page.click('[data-ref="confirm"]');
  check(await message(page) === 'Preencha Nome, Sobrenome e E-Mail.', `${label}: confirmar vazio deveria pedir os três campos`);

  // nome e sobrenome: inicial maiúscula enquanto digita (conectivo no meio fica minúsculo)
  await typeInto(page, 'firstName', 'joão pedro');
  check(await value(page, 'firstName') === 'João Pedro', `${label}: nome deveria ficar "João Pedro" ao digitar`);
  await typeInto(page, 'lastName', 'da silva e souza');
  check(await value(page, 'lastName') === 'Da Silva e Souza', `${label}: sobrenome deveria ficar "Da Silva e Souza" ao digitar`);

  // e-mail com erro de digitação → sugestão; "Corrigir" aplica
  await typeInto(page, 'email', 'Joao@gmial.com');
  await page.waitForTimeout(1300); // o aviso espera a pessoa parar de digitar (1,1 s)
  check(await message(page) === 'Você Quis Dizer joao@gmail.com Corrigir', `${label}: deveria sugerir joao@gmail.com (veio "${await message(page)}")`);
  check(await text(page, 'idTotal') === 'R$ 48,00' && await text(page, 'idWas') === 'R$ 30,00', `${label}: não membro deveria pagar 4 × R$ 12,00 (com R$ 30,00 riscado)`);
  await page.click('.cs-hb');
  check(await value(page, 'email') === 'joao@gmail.com', `${label}: "Corrigir" deveria trocar o e-mail`);
  check((await message(page)).startsWith('Você Não é Um Membro do CITi'), `${label}: e-mail corrigido de fora do CITi deveria mostrar o aviso de não membro`);

  // e-mail mal formado → aviso ao sair do campo
  await typeInto(page, 'email', 'joao@@citi.org.br');
  await page.focus('[name="firstName"]');
  check(await message(page) === 'Digite Um E-Mail Válido.', `${label}: e-mail mal formado deveria ser apontado`);

  // membro: preço de membro, sem riscado; confirma
  await typeInto(page, 'email', 'Joao.Silva@CITI.org.br');
  await page.focus('[name="firstName"]');
  check((await message(page)).startsWith('Membro do CITi'), `${label}: e-mail do CITi deveria mostrar "Membro do CITi"`);
  check(await text(page, 'idTotal') === 'R$ 30,00' && await page.$eval('[data-ref="idWas"]', (el) => el.hidden), `${label}: membro deveria pagar R$ 30,00`);
  await page.click('[data-ref="confirm"]');
  const sent = await page.evaluate(() => window.__checkouts.at(-1)?.customer);
  check(JSON.stringify(sent) === JSON.stringify({ firstName: 'João Pedro', lastName: 'Da Silva e Souza', email: 'joao.silva@citi.org.br', member: true }),
    `${label}: pedido deveria levar o comprador arrumado (veio ${JSON.stringify(sent)})`);

  // a cobrança vai ao servidor só com nome, e-mail, sabores e quantidades
  await checkPixShown(page, label, 'R$ 30,00');
  check(JSON.stringify(api.created.at(-1)) === JSON.stringify({ buyer_name: 'João Pedro Da Silva e Souza', payer_email: 'joao.silva@citi.org.br', items: [{ product_id: 'original', quantity: 4 }] }),
    `${label}: POST /api/orders com corpo errado (${JSON.stringify(api.created.at(-1))})`);

  // cancelar devolve as latas ao carrinho, com aviso
  await cancelPix(page);
  check(await text(page, 'cartTotal') === 'R$ 30,00' && await text(page, 'cartBadge') === '4', `${label}: cancelar o Pix deveria manter as 4 latas no carrinho`);
  check(await note(page) === 'Pix Cancelado. Suas Latas Continuam no Carrinho.', `${label}: cancelar deveria avisar (veio "${await note(page)}")`);
  check(await page.$eval('[data-ref="close"]', (el) => el.checkVisibility({ visibilityProperty: true })), `${label}: fora do Pix o X deveria voltar`);

  // voltar da identificação ao carrinho mantém o que foi digitado
  await page.click('[data-ref="checkout"]');
  await settleDrawer(page);
  await page.click('[data-ref="back"]');
  await page.waitForTimeout(900);
  check(await page.$eval('[data-ref="drawer"]', (el) => !el.classList.contains('is-identify')), `${label}: voltar deveria levar ao carrinho`);
  check(await value(page, 'email') === 'Joao.Silva@CITI.org.br', `${label}: voltar não deveria apagar o e-mail digitado`);
}

// A API que a página usa é toda respondida pelo teste; o servidor só entrega a página e os arquivos.
const server = spawn('.venv/bin/uvicorn', ['app.main:app', '--port', String(PORT), '--log-level', 'warning'], {
  stdio: 'ignore',
  env: { ...process.env, ...LOCAL_SERVER_ENV },
});
try {
  await waitForServer();
  // WebGL desligado: valida a interface de forma determinística (a geladeira 3D é opcional por design)
  const browser = await chromium.launch({ args: ['--disable-webgl', '--disable-3d-apis'] });
  for (const viewport of VIEWPORTS) {
    const { page, label, errors, api } = await openStore(browser, viewport);
    try {
      await checkFlow(page, label, api);
      await page.click('[data-ref="cartButton"]').catch(() => {});
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      await goToFlavor(page, INDEX.original);
      await checkLayout(page, label);
    } catch (error) {
      failures.push(`${label}: ${error.message.split('\n')[0]}`);
    }
    if (process.env.UI_SCREENSHOTS) await page.screenshot({ path: `${process.env.UI_SCREENSHOTS}/${viewport.width}x${viewport.height}.png` });
    failures.push(...errors, ...(await page.evaluate(() => window.__violations)).map((v) => `${label}: violação de CSP — ${v}`));
    await page.close();
  }

  // comprador lembrado: a identificação já vem preenchida e confirmar lembra de novo
  {
    const buyer = { first_name: 'Ana', last_name: 'Souza', email: 'ana@citi.org.br' };
    const { page, label, errors, remembered } = await openStore(browser, VIEWPORTS[2], { buyer });
    await page.waitForSelector('.cv-it.is-selected');
    await page.click('[data-ref="add"]');
    await page.click('[data-ref="cartButton"]');
    await page.waitForTimeout(1200);
    await page.click('[data-ref="checkout"]');
    await page.waitForTimeout(900);
    check(await value(page, 'firstName') === 'Ana' && await value(page, 'lastName') === 'Souza' && await value(page, 'email') === 'ana@citi.org.br',
      `${label}: identificação deveria vir preenchida com o comprador lembrado`);
    check((await message(page)).startsWith('Membro do CITi'), `${label}: comprador lembrado do CITi deveria ver "Membro do CITi" de imediato`);
    await page.click('[data-ref="confirm"]');
    await page.waitForTimeout(300);
    check(JSON.stringify(remembered.at(-1)) === JSON.stringify(buyer), `${label}: pedido aceito deveria lembrar o comprador (veio ${JSON.stringify(remembered.at(-1))})`);
    failures.push(...errors, ...(await page.evaluate(() => window.__violations)).map((v) => `${label}: violação de CSP — ${v}`));
    await page.close();
  }

  // pagamento: pago (modo de testes), expirado com estoque que mudou e falhas ao criar a cobrança
  for (const viewport of [VIEWPORTS[0], VIEWPORTS[2], VIEWPORTS[4], VIEWPORTS[8]]) {
    const buyer = { first_name: 'Ana', last_name: 'Souza', email: 'ana@citi.org.br' };
    const { page, label, errors, remembered, api } = await openStore(browser, viewport, { buyer });
    try {
      await page.waitForSelector('.cv-it.is-selected');
      const toPix = async () => {
        await page.click('[data-ref="cartButton"]');
        await settleDrawer(page);
        await page.click('[data-ref="checkout"]');
        await settleDrawer(page);
        await page.click('[data-ref="confirm"]');
      };

      // falha do provedor: fica na identificação, com aviso, sem lembrar ninguém
      await page.click('[data-ref="add"]');
      api.createStatus = 502;
      await toPix();
      await page.waitForTimeout(400);
      check(await drawerHas(page, 'is-identify') && await note(page) === 'Não Foi Possível Gerar o Pix. Tente De Novo.', `${label}: falha ao criar a cobrança deveria avisar na identificação`);
      check(remembered.length === 0, `${label}: pedido recusado não deveria lembrar o comprador`);

      // estoque acabou antes: volta ao carrinho ajustado
      api.createStatus = 409;
      api.stock.original = 0;
      await page.click('[data-ref="confirm"]');
      await page.waitForFunction(() => !document.querySelector('[data-ref="drawer"]').classList.contains('is-identify'), null, { timeout: 5000 });
      await settleDrawer(page);
      check(await note(page) === 'Original Esgotou.', `${label}: 409 deveria avisar que o Original esgotou (veio "${await note(page)}")`);
      check(await page.$$eval('.cs-it.is-gone', (els) => els.length) === 1 && await page.$eval('[data-ref="checkout"]', (el) => !el.checkVisibility()),
        `${label}: sabor esgotado deveria ficar apagado no carrinho, sem "Finalizar Compra"`);
      check(await page.$eval('.cv-it[data-index="0"]', (el) => el.classList.contains('is-sold-out')), `${label}: o carrossel deveria mostrar o Original esgotado`);
      await page.click('.cs-it.is-gone [data-action="dismiss"]');
      check(await page.$eval('[data-ref="cartEmpty"]', (el) => !el.hidden), `${label}: tirar o esgotado deveria deixar o carrinho vazio`);
      await page.click('[data-ref="close"]');
      await page.waitForTimeout(400);

      // pago pelo modo de testes: tela final, "Concluir" esvazia o carrinho e fecha
      api.createStatus = 201;
      await goToFlavor(page, 1);
      await page.click('[data-ref="qtyUp"]');
      await page.click('[data-ref="add"]');
      await toPix();
      await checkPixShown(page, label, 'R$ 16,00');
      check(JSON.stringify(remembered.at(-1)) === JSON.stringify(buyer), `${label}: pedido aceito deveria lembrar o comprador`);
      // o banco confirmou: a próxima consulta (feita na hora ao voltar à página) mostra o pago
      api.set(api.last().id, 'PAID', 'APPROVED');
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await page.waitForSelector('.cs-pg-pay.is-done .pqr-in.is-paid', { timeout: 5000 });
      await settleDrawer(page);
      const bought = await page.$eval('.cv-it[data-index="1"]', (el) => el.getAttribute('aria-label'));
      check(await page.$eval('.pqr', (el) => el.textContent.replace(/\s+/g, ' ').trim()) === `Pagamento Aprovado Pode Pegar Suas Latas na Geladeira. 2× ${bought} Pedido #${api.last().id.slice(0, 8).toUpperCase()}`,
        `${label}: tela de pago errada ("${await page.$eval('.pqr', (el) => el.textContent.replace(/\s+/g, ' ').trim())}")`);
      check(await text(page, 'payLabel') === 'Concluir' && await text(page, 'payCount') === 'Total Pago · 2 Un.', `${label}: pago deveria mostrar "Total Pago" e "Concluir"`);
      check(!(await drawerHas(page, 'is-locked')) && await inView(page, '[data-ref="payAction"]') && await inView(page, '.pqr-orb'), `${label}: tela de pago deveria caber na tela e soltar a gaveta`);
      await page.click('[data-ref="payAction"]');
      await page.waitForTimeout(700);
      check(!(await drawerHas(page, 'is-open')) && await page.$eval('[data-ref="cartBadge"]', (el) => el.hidden), `${label}: "Concluir" deveria fechar a gaveta com o carrinho vazio`);

      // expirado com o estoque mudando no meio: as latas voltam conferidas
      await goToFlavor(page, 2);
      await page.click('[data-ref="qtyUp"]');
      await page.click('[data-ref="qtyUp"]');
      await page.click('[data-ref="add"]');
      await goToFlavor(page, 3);
      await page.click('[data-ref="add"]');
      const [second, third] = await page.$$eval('.cv-it', (els) => [2, 3].map((i) => els[i].getAttribute('aria-label')));
      await toPix();
      await checkPixShown(page, label, 'R$ 30,00');
      const ids = api.created.at(-1).items.map((item) => item.product_id);
      api.stock[ids[0]] = 1;
      api.stock[ids[1]] = 0;
      api.set(api.last().id, 'CANCELLED', 'EXPIRED');
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); // volta do app do banco: consulta na hora
      await page.waitForSelector('.cs-pg-pay.is-done .pqr-in.is-expired', { timeout: 5000 });
      check((await page.$eval('.pqr-t', (el) => el.textContent)) === 'Tempo Esgotado' && await text(page, 'payLabel') === 'Voltar ao Carrinho', `${label}: Pix expirado deveria mostrar "Tempo Esgotado"`);
      await page.click('[data-ref="payAction"]');
      await page.waitForFunction(() => !document.querySelector('[data-ref="drawer"]').classList.contains('is-pay'), null, { timeout: 5000 });
      await settleDrawer(page);
      check(await note(page) === 'O Estoque Mudou. Seu Carrinho Foi Ajustado.', `${label}: estoque mudado deveria ser avisado (veio "${await note(page)}")`);
      check(await text(page, 'cartBadge') === '1' && await text(page, 'cartTotal') === 'R$ 8,50', `${label}: carrinho deveria ficar com 1 lata de ${second} (R$ 8,50)`);
      check(await page.$eval('.cs-it.is-gone .cs-nm', (el) => el.textContent) === third, `${label}: ${third} deveria aparecer esgotado no carrinho`);
    } catch (error) {
      failures.push(`${label}: ${error.message.split('\n')[0]}`);
    }
    if (process.env.UI_SCREENSHOTS) await page.screenshot({ path: `${process.env.UI_SCREENSHOTS}/pix-${viewport.width}x${viewport.height}.png` });
    failures.push(...errors, ...(await page.evaluate(() => window.__violations)).map((v) => `${label}: violação de CSP — ${v}`));
    await page.close();
  }

  // modo leve (aparelho fraco, forçado com ?3d=0): nada da geladeira 3D é baixado, a imagem dela
  // fica, porta e recentralizar somem e a compra funciona igual
  {
    const { page, label, errors, requested } = await openStore(browser, VIEWPORTS[1], { path: '?3d=0' });
    try {
      await page.waitForSelector('.cv-it.is-selected');
      await page.waitForTimeout(2500);
      // (scene/cooler-frame.js é só a conta do enquadramento, sem Three.js: faz parte da interface)
      const heavy = requested.filter((url) => /\/(cooler|vendor\/three|vendor\/gsap)\/|\/scene\/(?!cooler-frame\.js)/.test(url));
      check(heavy.length === 0, `${label}: modo leve não deveria baixar nada da cena 3D (baixou ${heavy.length}: ${heavy.slice(0, 3).join(', ')})`);
      check(await page.evaluate(() => document.documentElement.classList.contains('is-lite') && document.querySelector('.app').classList.contains('no-3d')),
        `${label}: modo leve deveria marcar is-lite e no-3d`);
      check(!(await page.$eval('[data-ref="door"]', (el) => el.checkVisibility())), `${label}: sem 3D o botão da porta deveria sumir`);
      check(await page.$eval('#boot .boot__dark', (el) => el.checkVisibility()), `${label}: sem 3D a imagem da geladeira deveria ficar na tela`);
      await page.click('[data-ref="add"]');
      check(await text(page, 'cartBadge') === '1', `${label}: no modo leve a lata deveria entrar no carrinho`);
    } catch (error) {
      failures.push(`${label}: ${error.message.split('\n')[0]}`);
    }
    failures.push(...errors, ...(await page.evaluate(() => window.__violations)).map((v) => `${label}: violação de CSP — ${v}`));
    await page.close();
  }

  // API fora do ar: mensagem de erro com botão para tentar de novo
  const { page, label } = await openStore(browser, VIEWPORTS[2], { productsStatus: 503 });
  await page.waitForSelector('.pdv-status', { timeout: 5000 }).catch(() => failures.push(`${label}: falha da API deveria mostrar o aviso de erro`));
  await page.close();
  await browser.close();

  // WebGL ligado: a geladeira 3D (Mini Cooler do kit) carrega sem erro nem violação de
  // CSP e as latas que saem dela respeitam o estoque. Usa o Chrome instalado, com GPU, quando existe;
  // sem GPU (SwiftShader) as animações mal andam, então só o carregamento é conferido.
  let gl;
  let gpu = true;
  try {
    gl = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  } catch {
    gpu = false;
    gl = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  }
  for (const viewport of [VIEWPORTS[2], VIEWPORTS[8]]) {
    const { page, label, errors } = await openStore(gl, viewport);
    const loaded = await page.waitForFunction(() => document.querySelector('.cv-it.is-selected'), null, { timeout: 60000, polling: 500 })
      .then(() => true, () => false);
    check(loaded, `[3D] ${label}: a loja não terminou de carregar com WebGL`);
    if (loaded && gpu) {
      // a geladeira só aparece depois do motor do kit e das latas (GLB) carregados
      const ready = await page.waitForSelector('.cw canvas.is-ready', { timeout: 90000 }).then(() => true, () => false);
      check(ready, `[3D] ${label}: a geladeira 3D não apareceu`);
      await page.waitForTimeout(1500);
      await goToFlavor(page, INDEX.tropical); // 3 em estoque
      await page.$eval('[data-ref="qtyUp"]', (b) => b.click());
      await page.$eval('[data-ref="qtyUp"]', (b) => b.click());
      await page.$eval('[data-ref="add"]', (b) => b.click());
      await page.$eval('[data-ref="add"]', (b) => b.click()); // já está no limite: não pode tirar mais latas
      const landed = await page.waitForFunction(() => document.querySelector('[data-ref="cartBadge"] b')?.textContent === '3', null, { timeout: 20000, polling: 250 })
        .then(() => true, () => false);
      check(landed, `[3D] ${label}: as 3 latas deveriam chegar ao carrinho`);
      await page.waitForTimeout(1500);
      check(await text(page, 'cartBadge') === '3', `[3D] ${label}: carrinho passou do estoque da Tropical (3)`);
      check(await page.$eval('[data-ref="add"]', (b) => b.disabled), `[3D] ${label}: "Adicionar" deveria travar no limite do estoque`);
    }
    await page.waitForTimeout(1000);
    failures.push(...errors.map((e) => `[3D] ${e}`), ...(await page.evaluate(() => window.__violations)).map((v) => `[3D] ${label}: violação de CSP — ${v}`));
    await page.close();
  }
  await gl.close();
  if (!gpu) console.warn('aviso: Chrome com GPU indisponível; animação das latas não conferida');
} finally {
  server.kill();
}

if (failures.length) {
  console.error(`✗ ${failures.length} falha(s):\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log(`✓ loja OK em ${VIEWPORTS.length} tamanhos de tela, com CSP de produção e com/sem WebGL`);
