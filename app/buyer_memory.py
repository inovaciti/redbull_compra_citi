"""Lembrança do comprador neste aparelho.

A loja pergunta nome, sobrenome e e-mail a cada pedido. Para a pessoa não digitar tudo de
novo, os dados confirmados ficam num cookie deste site, guardado no próprio aparelho dela:
nada vai para o banco. O cookie é definido pelo servidor (``Set-Cookie``), ``HttpOnly``,
restrito ao caminho ``/api/comprador`` (não acompanha as outras requisições) e renovado a
cada visita. Cookie definido pelo servidor é o que os navegadores mais preservam: o Safari,
por exemplo, apaga em 7 dias sem visita o que a página grava por script (``localStorage``,
``document.cookie``), mas não este.

Nunca registrar o conteúdo do cookie em log (tem nome e e-mail).
"""

import base64
import binascii
import json

from fastapi import APIRouter, Request, Response
from pydantic import ValidationError

from .models import RememberedBuyer

COOKIE_NAME = "rb_comprador"
COOKIE_PATH = "/api/comprador"
# 400 dias: o máximo que os navegadores aceitam; cada visita renova o prazo
COOKIE_MAX_AGE = 400 * 24 * 60 * 60
NO_STORE = {"Cache-Control": "no-store"}

router = APIRouter()


def _encode(buyer: RememberedBuyer) -> str:
    raw = json.dumps(buyer.model_dump(), ensure_ascii=False, separators=(",", ":"))
    return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")


def _decode(value: str) -> RememberedBuyer | None:
    try:
        raw = base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
        return RememberedBuyer.model_validate(json.loads(raw))
    except (binascii.Error, UnicodeDecodeError, ValueError, ValidationError):
        return None


def _remember(response: Response, request: Request, buyer: RememberedBuyer) -> None:
    response.set_cookie(
        COOKIE_NAME,
        _encode(buyer),
        max_age=COOKIE_MAX_AGE,
        path=COOKIE_PATH,
        httponly=True,
        secure=request.url.scheme == "https",
        samesite="strict",
    )


@router.get("/api/comprador", response_model=RememberedBuyer | None)
def remembered_buyer(request: Request, response: Response) -> RememberedBuyer | None:
    """Comprador lembrado neste aparelho (ou null). Renova o prazo do cookie."""
    response.headers.update(NO_STORE)
    stored = request.cookies.get(COOKIE_NAME)
    if not stored:
        return None
    buyer = _decode(stored)
    if buyer is None:
        response.delete_cookie(COOKIE_NAME, path=COOKIE_PATH, httponly=True, samesite="strict")
        return None
    _remember(response, request, buyer)
    return buyer


@router.put("/api/comprador", status_code=204)
def remember_buyer(buyer: RememberedBuyer, request: Request) -> Response:
    """Lembra o comprador que acabou de confirmar um pedido."""
    response = Response(status_code=204, headers=NO_STORE)
    _remember(response, request, buyer)
    return response
