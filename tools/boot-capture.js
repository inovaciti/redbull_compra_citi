// Página de captura do gerador da imagem do loading (tools/render-boot-poster.mjs).
// Monta a loja real com a geladeira apagada, de frente, sem latas e com o vidro todo embaçado.
// (Adaptado do pacote loading-geladeira para a plataforma: a loja recebe catálogo e preços
// prontos; todos os sabores com estoque 0, para a geladeira ficar vazia.)

import { mountStorefront } from '/static/storefront/src/storefront.js';
import { createPricing } from '/static/storefront/src/pricing.js';
import { FLAVOR_VISUALS } from '/static/storefront/src/data/flavors.js';

/** A captura não compra nada: qualquer chamada de pagamento é um erro da ferramenta. */
function noPayment() {
  const refuse = () => Promise.reject(new Error('Sem pagamento na captura do pôster.'));
  return { create: refuse, status: refuse, cancel: refuse, stock: refuse };
}

const veil = Number(new URLSearchParams(location.search).get('veil') ?? 1);
const shop = mountStorefront(document.getElementById('storefront'), {
  catalog: FLAVOR_VISUALS.map((visual) => ({ ...visual, name: visual.id, stock: 0 })),
  pricing: createPricing([{ min_quantity: 1, max_quantity: null, unit_price: 8.5 }]),
  guestPricing: createPricing([{ min_quantity: 1, max_quantity: null, unit_price: 12 }]),
  payment: noPayment(),
  fridge: { power: 0, startView: 'front', condensationVeil: veil },
});

window.bootCapture = shop.ready.then((scene) => {
  if (!scene) throw new Error('A geladeira 3D não carregou.');
  return {
    fridgeRect: () => scene.fridgeScreenRect(),
    ledOutline: (count) => scene.ledOutline(count),
    setPower: (levels) => scene.setPower(levels),
  };
});
