// Preço por faixa de quantidade, a partir da tabela fixa servida pela API
// (`GET /api/price-tiers`, gerada de `app/pricing.py`). A faixa é escolhida pela
// quantidade TOTAL do pedido (todos os sabores somados) e vale para todas as
// latas. O valor daqui é só para exibição: o pedido manda apenas sabores e
// quantidades, e o back-end calcula e cobra pela própria tabela.

/**
 * @typedef {{ min_quantity: number, max_quantity: number | null, unit_price: number }} PriceTier
 */

/** Conta em centavos inteiros: nada de 0,1 + 0,2 no valor exibido. */
const toCents = (value) => Math.round(value * 100);

/** @param {PriceTier[]} tiers */
export function createPricing(tiers) {
  const sorted = [...tiers].sort((a, b) => a.min_quantity - b.min_quantity);

  /** Preço unitário da faixa que cobre `count` latas (ao menos 1), ou null se nenhuma cobre. */
  function unitPrice(count) {
    const n = Math.max(1, count);
    const tier = sorted.find((t) => n >= t.min_quantity && (t.max_quantity === null || n <= t.max_quantity));
    return tier ? tier.unit_price : null;
  }

  /** `count` latas a `unit` cada. */
  function lineTotal(unit, count) {
    return (toCents(unit) * count) / 100;
  }

  /** Total de `count` latas. */
  function total(count) {
    if (count <= 0) return 0;
    const unit = unitPrice(count);
    return unit === null ? 0 : lineTotal(unit, count);
  }

  return { unitPrice, lineTotal, total };
}
