"""Tabela fixa de preços: valores exatos, regra do banco igual à do código e travas."""

import asyncio
from decimal import Decimal
from uuid import uuid4

import pytest
from sqlalchemy import delete, func, select, text, update
from sqlalchemy.exc import IntegrityError

from app import pricing
from app.db.base import AsyncSessionLocal, engine
from app.db.models import OrderItemORM, OrderORM, ProductORM
from app.models import OrderCreate, OrderItemInput, OrderStatus, PricingAudience, ReservationStatus
from app.payment_service import PaymentServiceError, _ensure_fixed_price
from app.store import store

MEMBER = PricingAudience.MEMBER
NON_MEMBER = PricingAudience.NON_MEMBER


# --- Tabela -------------------------------------------------------------------


@pytest.mark.parametrize(
    ("quantity", "total"),
    [(1, "8.50"), (2, "16.00"), (3, "24.00"), (4, "30.00"), (5, "37.50"), (10, "75.00")],
)
def test_member_prices_are_exactly_the_agreed_ones(quantity, total):
    assert pricing.order_total(MEMBER, quantity) == Decimal(total)


@pytest.mark.parametrize("quantity", [1, 2, 3, 4, 5, 20, 100])
def test_non_member_always_pays_12_per_can(quantity):
    assert pricing.unit_price(NON_MEMBER, quantity) == Decimal("12.00")
    assert pricing.order_total(NON_MEMBER, quantity) == Decimal("12.00") * quantity


@pytest.mark.parametrize("quantity", [0, -1, 1.0, "1", True, None])
def test_invalid_quantity_never_gets_a_price(quantity):
    with pytest.raises(ValueError):
        pricing.unit_price(MEMBER, quantity)


def test_price_table_cannot_be_changed_at_runtime():
    with pytest.raises(TypeError):
        pricing._TIERS[MEMBER] = ((1, None, Decimal("0.01")),)
    with pytest.raises(TypeError):
        pricing._TIERS[MEMBER][0][2] = Decimal("0.01")
    assert pricing.order_total(MEMBER, 1) == Decimal("8.50")


# --- Banco: mesma regra e travas -----------------------------------------------


def run(coro_factory):
    async def wrapper():
        try:
            return await coro_factory()
        finally:
            await engine.dispose()

    return asyncio.run(wrapper())


async def _reset():
    async with AsyncSessionLocal() as session, session.begin():
        await session.execute(delete(OrderORM))
        await session.execute(
            update(ProductORM).where(ProductORM.id == "original").values(stock=24, reserved_stock=0)
        )


async def _new_order(email: str, quantity: int):
    await _reset()
    async with AsyncSessionLocal() as session:
        reserved = await store.reserve_order(
            session,
            OrderCreate(
                buyer_name="Comprador",
                payer_email=email,
                items=[OrderItemInput(product_id="original", quantity=quantity)],
            ),
        )
    return reserved.id


def test_database_price_rule_matches_code():
    async def scenario():
        async with AsyncSessionLocal() as session:
            mismatches = []
            for audience in PricingAudience:
                for quantity in range(1, 61):
                    sql = await session.scalar(
                        select(func.fn_expected_unit_price(text(f"'{audience.value}'::pricing_audience"), quantity))
                    )
                    if sql != pricing.unit_price(audience, quantity):
                        mismatches.append((audience, quantity, sql))
            return mismatches

    assert run(scenario) == []


@pytest.mark.parametrize(
    "tamper",
    [
        "UPDATE order_items SET unit_price = 0.01, subtotal = 0.01 * quantity",
        "UPDATE order_items SET subtotal = 0.01",
        "UPDATE orders SET total = 0.01",
        "UPDATE orders SET pricing_audience = 'MEMBER'",
        "UPDATE orders SET payer_email = 'outro@citi.org.br'",
        "UPDATE order_items SET quantity = quantity + 1",
        "DELETE FROM order_items",
    ],
)
def test_database_refuses_any_price_change_on_an_order(tamper):
    async def scenario():
        order_id = await _new_order("comprador@example.com", 2)
        async with AsyncSessionLocal() as session:
            with pytest.raises(IntegrityError, match="tabela fixa|público de preço|sem itens"):
                async with session.begin():
                    await session.execute(text(tamper))
        async with AsyncSessionLocal() as session:
            order = await session.get(OrderORM, order_id)
            return order.total, order.pricing_audience, [(i.quantity, i.unit_price) for i in order.items]

    assert run(scenario) == (Decimal("24.00"), NON_MEMBER, [(2, Decimal("12.00"))])


@pytest.mark.parametrize(
    ("email", "audience", "unit"),
    [
        ("comprador@example.com", "NON_MEMBER", "8.50"),  # não membro pagando preço de membro
        ("comprador@example.com", "MEMBER", "8.50"),  # público falso para o e-mail
        ("comprador@citi.org.br", "MEMBER", "1.00"),  # preço inventado
        ("comprador@citi.org.br", "MEMBER", "8.00"),  # faixa errada para 1 lata
    ],
)
def test_database_refuses_an_order_inserted_with_a_wrong_price(email, audience, unit):
    async def scenario():
        await _reset()
        async with AsyncSessionLocal() as session:
            with pytest.raises(IntegrityError):
                async with session.begin():
                    session.add(
                        OrderORM(
                            id=uuid4(),
                            buyer_name="Atacante",
                            payer_email=email,
                            total=Decimal(unit),
                            status=OrderStatus.PENDING,
                            created_at=func.now(),
                            pricing_audience=audience,
                            reservation_status=ReservationStatus.RELEASED,
                            items=[
                                OrderItemORM(
                                    product_id="original",
                                    product_name="Original",
                                    quantity=1,
                                    unit_price=Decimal(unit),
                                    subtotal=Decimal(unit),
                                )
                            ],
                        )
                    )
        async with AsyncSessionLocal() as session:
            return await session.scalar(select(func.count()).select_from(OrderORM))

    assert run(scenario) == 0


def test_order_changes_that_do_not_touch_price_still_work():
    async def scenario():
        order_id = await _new_order("comprador@citi.org.br", 3)
        async with AsyncSessionLocal() as session, session.begin():
            await session.execute(
                update(OrderORM).where(OrderORM.id == order_id).values(status=OrderStatus.CANCELLED)
            )
        async with AsyncSessionLocal() as session:
            order = await session.get(OrderORM, order_id)
            return order.status, order.total

    assert run(scenario) == (OrderStatus.CANCELLED, Decimal("24.00"))


# --- Conferência antes de cobrar -------------------------------------------------


def _order(email, audience, unit, quantity=1, total=None):
    unit = Decimal(unit)
    return OrderORM(
        id=uuid4(),
        payer_email=email,
        pricing_audience=audience,
        total=total if total is not None else unit * quantity,
        items=[OrderItemORM(quantity=quantity, unit_price=unit, subtotal=unit * quantity)],
    )


def test_charge_check_accepts_the_fixed_price():
    _ensure_fixed_price(_order("a@citi.org.br", MEMBER, "8.00", quantity=2))
    _ensure_fixed_price(_order("a@example.com", NON_MEMBER, "12.00", quantity=4))


@pytest.mark.parametrize(
    "order",
    [
        _order("a@example.com", MEMBER, "8.50"),
        _order("a@citi.org.br", NON_MEMBER, "12.00"),
        _order("a@citi.org.br", MEMBER, "8.50", quantity=2),
        _order("a@citi.org.br", MEMBER, "8.50", total=Decimal("1.00")),
        _order(None, NON_MEMBER, "12.00"),
    ],
)
def test_charge_is_blocked_when_the_order_price_is_off_the_table(order):
    with pytest.raises(PaymentServiceError):
        _ensure_fixed_price(order)
