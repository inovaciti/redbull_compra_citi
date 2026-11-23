// Pagamento na plataforma: liga a etapa Pix da gaveta à API de pedidos.
//
//   POST /api/orders                cria o pedido (reserva o estoque) e a cobrança Pix
//   GET  /api/orders/{id}           situação do pedido e do pagamento
//   POST /api/orders/{id}/cancel    cancela a cobrança e libera a reserva
//   GET  /api/products              estoque atual (já sem as reservas)
//
// O navegador manda só sabores, quantidades, nome e e-mail: preço, total e público vêm do
// servidor. A resposta vira uma `Charge` (formato da loja, ver storefront.js), e as falhas
// viram `CheckoutError` com o motivo que a loja sabe tratar.

/** Por que uma chamada de pagamento falhou. */
class CheckoutError extends Error {
  /**
   * @param {'stock' | 'invalid' | 'conflict' | 'provider' | 'network'} reason
   *   stock: estoque insuficiente ao criar · invalid: dados recusados · conflict: a cobrança
   *   mudou de situação antes (ex.: paga enquanto era cancelada) · provider: falha do servidor
   *   ou do Mercado Pago · network: sem resposta
   */
  constructor(reason, message) {
    super(message);
    this.name = 'CheckoutError';
    this.reason = reason;
  }
}

const REASON_BY_STATUS = { 409: 'stock', 422: 'invalid' };

/** Situação da cobrança para a loja, a partir dos três estados do pedido no servidor. */
function chargeStatus({ status, payment }) {
  if (status === 'PAID' || payment.status === 'APPROVED') return 'paid';
  if (payment.status === 'EXPIRED') return 'expired';
  if (payment.status === 'FAILED') return 'failed';
  if (status === 'CANCELLED' || payment.status === 'CANCELLED') return 'cancelled';
  return 'pending';
}

/**
 * @param {{ onCreated?: (order: import('./storefront.js').Order) => void }} [hooks]
 *   `onCreated`: pedido aceito pelo servidor (a plataforma lembra o comprador aqui)
 */
export function createCheckoutApi({ onCreated } = {}) {
  // diferença entre o relógio do aparelho e o do servidor (cabeçalho Date): a contagem
  // regressiva do Pix não pode depender de o celular estar com a hora certa
  let clockSkew = 0;

  async function request(url, { method = 'GET', body, conflict = 'stock' } = {}) {
    let response;
    try {
      response = await fetch(url, {
        method,
        headers: body ? { Accept: 'application/json', 'Content-Type': 'application/json' } : { Accept: 'application/json' },
        body: body && JSON.stringify(body),
        cache: 'no-store',
      });
    } catch {
      throw new CheckoutError('network', 'sem resposta do servidor');
    }
    if (!response.ok) {
      const reason = response.status === 409 ? conflict : REASON_BY_STATUS[response.status] ?? 'provider';
      throw new CheckoutError(reason, `${method} ${url} respondeu ${response.status}`);
    }
    const date = Date.parse(response.headers.get('Date') ?? '');
    if (!Number.isNaN(date)) clockSkew = Date.now() - date;
    return response.json();
  }

  /** Pedido do servidor → `Charge` da loja. */
  function toCharge(order) {
    const expiresAt = order.payment.expires_at ? Date.parse(order.payment.expires_at) + clockSkew : null;
    return {
      id: order.id,
      number: order.id.slice(0, 8).toUpperCase(),
      status: chargeStatus(order),
      qr: order.payment.qr_code,
      code: order.payment.copy_paste,
      expiresAt,
      total: order.total,
      count: order.items.reduce((sum, item) => sum + item.quantity, 0),
      items: order.items.map((item) => ({ id: item.product_id, quantity: item.quantity })),
    };
  }

  return {
    /** @param {import('./storefront.js').Order} order pedido com o comprador identificado */
    async create(order) {
      const created = await request('/api/orders', {
        method: 'POST',
        body: {
          buyer_name: `${order.customer.firstName} ${order.customer.lastName}`,
          payer_email: order.customer.email,
          items: order.items.map(({ id, quantity }) => ({ product_id: id, quantity })),
        },
      });
      onCreated?.(order);
      return toCharge(created);
    },
    async status(charge) {
      return toCharge(await request(`/api/orders/${encodeURIComponent(charge.id)}`));
    },
    async cancel(charge) {
      return toCharge(await request(`/api/orders/${encodeURIComponent(charge.id)}/cancel`, { method: 'POST', conflict: 'conflict' }));
    },
    /** Estoque disponível agora, por sabor. */
    async stock() {
      const products = await request('/api/products');
      return Object.fromEntries(products.map((product) => [product.id, product.stock]));
    },
  };
}
