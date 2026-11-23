// Inicialização do PDV na plataforma: busca produtos, faixas de preço e o comprador
// lembrado na API, junta com o visual de cada sabor e monta a loja com o pagamento Pix
// ligado à API de pedidos (src/checkout-api.js).
//
// O público do preço (membro ou não) é decidido pelo back-end a partir do
// e-mail do pagador: e-mail @citi.org.br paga a tabela de membro. Antes de o
// comprador se identificar, a loja mostra a tabela de membro; na identificação,
// o aviso abaixo do e-mail diz qual tabela vale.
//
// Lembrança do comprador: quem tem o pedido aceito pelo servidor fica lembrado
// neste aparelho (cookie do servidor, ver app/buyer_memory.py) e, na próxima
// visita, a identificação já vem preenchida.

import { mountStorefront } from './storefront.js';
import { createBoot } from './boot.js';
import { createPricing } from './pricing.js';
import { createCheckoutApi } from './checkout-api.js';
import { sceneTier } from './device-tier.js';
import { DEFAULT_VISUAL, FLAVOR_VISUALS } from './data/flavors.js';

const BUYER_URL = '/api/comprador';

async function getJson(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`${url} respondeu ${response.status}`);
  return response.json();
}

/** Comprador lembrado neste aparelho; sem ele (ou com falha), a identificação começa vazia. */
async function rememberedBuyer() {
  try {
    const buyer = await getJson(BUYER_URL);
    return buyer && { firstName: buyer.first_name, lastName: buyer.last_name, email: buyer.email };
  } catch {
    return null;
  }
}

/** Lembra quem confirmou o pedido, para a próxima visita (falha aqui não atrapalha a compra). */
function rememberBuyer({ firstName, lastName, email }) {
  fetch(BUYER_URL, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ first_name: firstName, last_name: lastName, email }),
    keepalive: true,
  }).catch(() => {});
}

/** "Energy Original" → "Original": o prefixo da marca não aparece na loja. */
const displayName = (name) => name.replace(/^Energy\s+/i, '');

/** Produtos da API + visual do sabor, na ordem de FLAVOR_VISUALS (desconhecidos no fim). */
function buildCatalog(products) {
  const order = new Map(FLAVOR_VISUALS.map((visual, index) => [visual.id, index]));
  return [...products]
    .sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity) || a.name.localeCompare(b.name, 'pt-BR'))
    .map((product) => {
      const known = order.has(product.id);
      const visual = known ? FLAVOR_VISUALS[order.get(product.id)] : DEFAULT_VISUAL;
      return {
        id: product.id,
        name: displayName(product.name),
        stock: product.stock,
        // produto sem visual próprio não ganha a lata 3D de outro sabor
        model: known ? visual.model ?? null : null,
        image: visual.image,
        can: visual.can,
        gradient: visual.gradient,
      };
    });
}

function showStatus(root, message) {
  const status = document.createElement('div');
  status.className = 'pdv-status';
  status.setAttribute('role', 'alert');
  const text = document.createElement('p');
  text.textContent = message;
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.textContent = 'Tentar novamente';
  retry.addEventListener('click', () => window.location.reload());
  status.append(text, retry);
  root.replaceChildren(status);
}

/** Sem loja para revelar (API fora ou sem sabores): o loading sai e a mensagem aparece. */
function cancelBoot() {
  document.getElementById('boot')?.remove();
  document.documentElement.classList.remove('is-booting', 'is-revealing');
}

async function start() {
  const root = /** @type {HTMLElement} */ (document.getElementById('storefront'));
  // o loading (geladeira apagada) já está na tela; daqui ele acompanha a montagem da loja
  const boot = createBoot();
  // quanto de 3D o aparelho aguenta, antes de qualquer download da geladeira; sem 3D, a
  // interface também troca o vidro desfocado por camadas leves (assets/styles/lite.css)
  const tier = sceneTier();
  document.documentElement.classList.toggle('is-lite', tier === 'none');
  try {
    const [products, memberTiers, guestTiers, customer] = await Promise.all([
      getJson('/api/products'),
      getJson('/api/price-tiers?pricing_audience=MEMBER'),
      getJson('/api/price-tiers?pricing_audience=NON_MEMBER'),
      rememberedBuyer(),
    ]);
    if (!products.length) {
      cancelBoot();
      showStatus(root, 'Nenhum sabor disponível no momento.');
      return;
    }
    if (!memberTiers.length || !guestTiers.length) throw new Error('nenhuma faixa de preço ativa');

    const shop = mountStorefront(root, {
      ...boot?.storefrontOptions,
      fridge: { ...boot?.storefrontOptions.fridge, quality: tier }, // o loading monta apagada e de frente
      catalog: buildCatalog(products),
      pricing: createPricing(memberTiers),
      guestPricing: createPricing(guestTiers),
      customer: customer ?? undefined,
      payment: createCheckoutApi({ onCreated: (order) => rememberBuyer(order.customer) }),
    });
    boot?.run(shop);
  } catch (error) {
    console.error('[pdv] falha ao carregar a loja:', error);
    cancelBoot();
    showStatus(root, 'Não foi possível carregar a loja. Verifique sua conexão.');
  }
}

start();
