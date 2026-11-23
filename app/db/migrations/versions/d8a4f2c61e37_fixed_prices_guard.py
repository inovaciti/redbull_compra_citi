"""preços fixos: remove price_tiers e trava o preço dos pedidos no banco

O preço deixa de ser um dado editável: a tabela vive em ``app/pricing.py``.
Esta revisão:

- remove ``orders.price_tier_id`` e a tabela ``price_tiers`` (e a edição pelo painel);
- cria ``fn_expected_unit_price(público, quantidade total)``, a mesma regra do código;
- cria gatilhos de restrição (verificados no COMMIT) que recusam qualquer pedido
  novo ou alterado cujo preço por lata, subtotal, total ou público (pelo e-mail)
  não batam com a tabela, venha a escrita da aplicação ou de SQL manual.

Pedidos antigos não são reescritos nem verificados enquanto ninguém mexer
nos seus itens/total: o ``order_items.unit_price`` deles continua sendo o
registro do que foi cobrado na época.

Revision ID: d8a4f2c61e37
Revises: c3f8a1d27b54
Create Date: 2026-11-18
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "d8a4f2c61e37"
down_revision: Union[str, Sequence[str], None] = "c3f8a1d27b54"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


UPGRADE_STATEMENTS = (
    "ALTER TABLE orders DROP COLUMN price_tier_id",
    "DROP TABLE price_tiers",
    # Mesma regra de app/pricing.py (tests/test_pricing.py confere as duas).
    """
    CREATE FUNCTION fn_expected_unit_price(p_audience pricing_audience, p_quantity integer)
    RETURNS numeric(10, 2)
    LANGUAGE sql IMMUTABLE STRICT
    AS $$
        SELECT CASE
            WHEN p_quantity < 1 THEN NULL
            WHEN p_audience = 'NON_MEMBER' THEN 12.00
            WHEN p_quantity = 1 THEN 8.50
            WHEN p_quantity <= 3 THEN 8.00
            ELSE 7.50
        END::numeric(10, 2)
    $$
    """,
    """
    CREATE FUNCTION fn_assert_order_price(p_order_id uuid)
    RETURNS void
    LANGUAGE plpgsql
    AS $$
    DECLARE
        v_audience  pricing_audience;
        v_email     text;
        v_total     numeric(10, 2);
        v_quantity  integer;
        v_subtotals numeric(10, 2);
        v_bad_items integer;
        v_expected  numeric(10, 2);
    BEGIN
        SELECT pricing_audience, payer_email, total
          INTO v_audience, v_email, v_total
          FROM orders
         WHERE id = p_order_id;
        IF NOT FOUND THEN
            RETURN;  -- pedido apagado (itens removidos em cascata)
        END IF;

        IF v_email IS NULL OR v_audience IS DISTINCT FROM (
            CASE WHEN split_part(lower(btrim(v_email)), '@', 2) = 'citi.org.br'
                 THEN 'MEMBER' ELSE 'NON_MEMBER' END
        )::pricing_audience THEN
            RAISE EXCEPTION 'Pedido %: público de preço não corresponde ao e-mail', p_order_id
                USING ERRCODE = 'check_violation';
        END IF;

        SELECT COALESCE(sum(quantity), 0), COALESCE(sum(subtotal), 0)
          INTO v_quantity, v_subtotals
          FROM order_items
         WHERE order_id = p_order_id;
        v_expected := fn_expected_unit_price(v_audience, v_quantity);
        IF v_expected IS NULL THEN
            RAISE EXCEPTION 'Pedido %: sem itens', p_order_id
                USING ERRCODE = 'check_violation';
        END IF;

        SELECT count(*)
          INTO v_bad_items
          FROM order_items
         WHERE order_id = p_order_id
           AND (unit_price <> v_expected OR subtotal <> unit_price * quantity);
        IF v_bad_items > 0
           OR v_subtotals <> v_expected * v_quantity
           OR v_total <> v_expected * v_quantity THEN
            RAISE EXCEPTION 'Pedido %: preço fora da tabela fixa', p_order_id
                USING ERRCODE = 'check_violation';
        END IF;
    END;
    $$
    """,
    """
    CREATE FUNCTION fn_orders_price_guard()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
        PERFORM fn_assert_order_price(NEW.id);
        RETURN NULL;
    END;
    $$
    """,
    """
    CREATE FUNCTION fn_order_items_price_guard()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
        IF TG_OP IN ('UPDATE', 'DELETE') THEN
            PERFORM fn_assert_order_price(OLD.order_id);
        END IF;
        IF TG_OP IN ('INSERT', 'UPDATE') THEN
            PERFORM fn_assert_order_price(NEW.order_id);
        END IF;
        RETURN NULL;
    END;
    $$
    """,
    # Verificados no COMMIT: o pedido e seus itens são gravados na mesma transação.
    """
    CREATE CONSTRAINT TRIGGER trg_orders_price_guard
    AFTER INSERT OR UPDATE OF total, pricing_audience, payer_email ON orders
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE PROCEDURE fn_orders_price_guard()
    """,
    """
    CREATE CONSTRAINT TRIGGER trg_order_items_price_guard
    AFTER INSERT OR UPDATE OR DELETE ON order_items
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE PROCEDURE fn_order_items_price_guard()
    """,
)

DOWNGRADE_STATEMENTS = (
    "DROP TRIGGER trg_order_items_price_guard ON order_items",
    "DROP TRIGGER trg_orders_price_guard ON orders",
    "DROP FUNCTION fn_order_items_price_guard()",
    "DROP FUNCTION fn_orders_price_guard()",
    "DROP FUNCTION fn_assert_order_price(uuid)",
    "DROP FUNCTION fn_expected_unit_price(pricing_audience, integer)",
)


def upgrade() -> None:
    for statement in UPGRADE_STATEMENTS:
        op.execute(sa.text(statement))


def downgrade() -> None:
    for statement in DOWNGRADE_STATEMENTS:
        op.execute(sa.text(statement))

    pricing_audience_enum = postgresql.ENUM(
        "MEMBER", "NON_MEMBER", name="pricing_audience", create_type=False
    )
    op.create_table(
        "price_tiers",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("pricing_audience", pricing_audience_enum, nullable=False),
        sa.Column("min_quantity", sa.Integer(), nullable=False),
        sa.Column("max_quantity", sa.Integer(), nullable=True),
        sa.Column("unit_price", sa.Numeric(10, 2), nullable=False),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.CheckConstraint("min_quantity >= 1", name="ck_price_tiers_min_quantity"),
        sa.CheckConstraint(
            "max_quantity IS NULL OR max_quantity >= min_quantity",
            name="ck_price_tiers_quantity_range",
        ),
        sa.CheckConstraint("unit_price > 0", name="ck_price_tiers_unit_price"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.execute(
        sa.text(
            """
            INSERT INTO price_tiers (pricing_audience, min_quantity, max_quantity, unit_price)
            VALUES ('MEMBER', 1, 1, 8.50),
                   ('MEMBER', 2, 3, 8.00),
                   ('MEMBER', 4, NULL, 7.50),
                   ('NON_MEMBER', 1, NULL, 12.00)
            """
        )
    )
    op.add_column("orders", sa.Column("price_tier_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_orders_price_tier_id_price_tiers",
        "orders",
        "price_tiers",
        ["price_tier_id"],
        ["id"],
    )
