"""Provedor Pix falso para os testes (o app só conhece o Mercado Pago).

Ele se apresenta como ``mercadopago`` e responde como o Mercado Pago responderia, guardando as
cobranças em memória. ``pay_via_webhook`` confirma um pagamento pelo caminho real: o provedor
passa a dizer "aprovado" e o webhook assinado chega ao app, que consulta o provedor e processa.
"""

import hashlib
import hmac
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from app.config import Settings
from app.payments import ChargeResult, PaymentProviderError, PaymentResult

WEBHOOK_SECRET = "segredo-do-webhook-de-teste"
APPROVED_AT = datetime(2026, 8, 4, 21, 30, tzinfo=UTC)


def fake_settings() -> Settings:
    return Settings(
        mercadopago_access_token="token-de-teste",
        mercadopago_webhook_secret=WEBHOOK_SECRET,
        charge_expires_in=1800,
    )


class FakePixProvider:
    provider_name = "mercadopago"

    def __init__(self) -> None:
        self.orders: dict[str, PaymentResult] = {}
        self.order_by_payment: dict[str, str] = {}
        self.cancelled: list[str] = []

    async def create_charge(
        self,
        external_reference: str,
        amount: Decimal,
        idempotency_key: str,
        payer_email: str,
    ) -> ChargeResult:
        if not idempotency_key:
            raise PaymentProviderError("A chave de idempotência é obrigatória")
        provider_order_id = f"fake-order-{external_reference}"
        provider_payment_id = f"fake-payment-{external_reference}"
        self.orders[provider_order_id] = PaymentResult(
            provider_order_id=provider_order_id,
            provider_payment_id=provider_payment_id,
            status="WAITING_PAYMENT",
            amount=amount,
            currency="BRL",
            approved_at=None,
        )
        self.order_by_payment[provider_payment_id] = provider_order_id
        return ChargeResult(
            provider_order_id=provider_order_id,
            provider_payment_id=provider_payment_id,
            qr_code=f"https://example.test/pix/{external_reference}",
            copy_paste=f"PIX-{external_reference}",
            amount=amount,
            expires_at=datetime.now(UTC) + timedelta(minutes=30),
        )

    async def get_order(self, order_id: str) -> PaymentResult:
        try:
            return self.orders[order_id]
        except KeyError as exc:
            raise PaymentProviderError("Order de teste não encontrada") from exc

    async def cancel_order(self, order_id: str, idempotency_key: str) -> None:
        current = self.orders[order_id]
        self.cancelled.append(order_id)
        self.orders[order_id] = PaymentResult(
            provider_order_id=order_id,
            provider_payment_id=current.provider_payment_id,
            status="CANCELLED",
            amount=current.amount,
            currency="BRL",
            approved_at=None,
        )

    async def aclose(self) -> None:
        return None

    def approve(self, provider_order_id: str) -> PaymentResult:
        """O comprador pagou: o provedor passa a responder "aprovado"."""
        current = self.orders[provider_order_id]
        approved = PaymentResult(
            provider_order_id=provider_order_id,
            provider_payment_id=current.provider_payment_id,
            status="APPROVED",
            amount=current.amount,
            currency="BRL",
            approved_at=APPROVED_AT,
        )
        self.orders[provider_order_id] = approved
        return approved


def signature_headers(order_id: str, request_id: str = "request-de-teste") -> dict:
    """Cabeçalhos x-signature/x-request-id como o Mercado Pago assina o webhook."""
    timestamp = "1785879000"
    normalized_id = order_id.lower() if order_id.isalnum() else order_id
    manifest = f"id:{normalized_id};request-id:{request_id};ts:{timestamp};"
    digest = hmac.new(WEBHOOK_SECRET.encode(), manifest.encode(), hashlib.sha256).hexdigest()
    return {"x-request-id": request_id, "x-signature": f"ts={timestamp},v1={digest}"}


def pay_via_webhook(client, provider: FakePixProvider, txid: str, event_id: str = "evento-de-teste"):
    """Aprova a cobrança do pedido (``payment.txid`` da API) e entrega o webhook assinado."""
    provider_order_id = provider.order_by_payment[txid]
    provider.approve(provider_order_id)
    return client.post(
        "/api/webhooks/mercadopago",
        params={"data.id": provider_order_id, "type": "order"},
        json={"id": event_id, "type": "order", "action": "order.updated", "data": {"id": provider_order_id}},
        headers=signature_headers(provider_order_id, request_id=event_id),
    )
