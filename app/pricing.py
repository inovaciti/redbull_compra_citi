"""Tabela de preços da loja: FIXA, definida aqui e em nenhum outro lugar.

Membros (e-mail exatamente ``@citi.org.br``), pela quantidade TOTAL do pedido,
somando todos os sabores; o preço da faixa vale para todas as latas:

- 1 lata: R$ 8,50
- 2 latas: R$ 16,00 (R$ 8,00 cada)
- 3 latas: R$ 24,00 (R$ 8,00 cada)
- 4 latas ou mais: R$ 7,50 cada (4 = R$ 30,00)

Não membros: R$ 12,00 por lata, sempre.

Não há tela, endpoint nem tabela no banco que altere esses valores. O cliente
nunca envia preço: ele manda só produtos e quantidades, e o público vem do
e-mail (``pricing_audience_for_email``). Como segunda barreira, o banco recusa
qualquer pedido cujo preço não bata com esta tabela (função
``fn_expected_unit_price`` e gatilhos da migration ``d8a4f2c61e37``; o teste
``test_database_price_rule_matches_code`` garante que as duas regras são iguais).
Mudar um preço exige mudar este arquivo, a migration e os testes juntos.
"""

from decimal import Decimal
from types import MappingProxyType

from .models import PriceTier, PricingAudience

CENTS = Decimal("0.01")

# (quantidade mínima, quantidade máxima ou None = sem limite, preço por lata)
# Somente leitura: nada no processo consegue trocar uma faixa em memória.
_TIERS = MappingProxyType({
    PricingAudience.MEMBER: (
        (1, 1, Decimal("8.50")),
        (2, 3, Decimal("8.00")),
        (4, None, Decimal("7.50")),
    ),
    PricingAudience.NON_MEMBER: ((1, None, Decimal("12.00")),),
})


def unit_price(audience: PricingAudience, total_quantity: int) -> Decimal:
    """Preço de cada lata num pedido com ``total_quantity`` latas no total."""
    if isinstance(total_quantity, bool) or not isinstance(total_quantity, int) or total_quantity < 1:
        raise ValueError("A quantidade total do pedido precisa ser um inteiro maior que zero")
    for min_quantity, max_quantity, price in _TIERS[PricingAudience(audience)]:
        if total_quantity >= min_quantity and (max_quantity is None or total_quantity <= max_quantity):
            return price
    raise ValueError("Nenhuma faixa de preço cobre esta quantidade")  # inalcançável: faixas contínuas


def order_total(audience: PricingAudience, total_quantity: int) -> Decimal:
    """Total do pedido com ``total_quantity`` latas."""
    return (unit_price(audience, total_quantity) * total_quantity).quantize(CENTS)


def price_tiers(audience: PricingAudience) -> list[PriceTier]:
    """Faixas para exibição (loja e painel)."""
    return [
        PriceTier(
            pricing_audience=audience,
            min_quantity=min_quantity,
            max_quantity=max_quantity,
            unit_price=float(price),
        )
        for min_quantity, max_quantity, price in _TIERS[audience]
    ]
