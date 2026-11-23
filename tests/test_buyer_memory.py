import base64

import pytest
from fastapi.testclient import TestClient

from app.buyer_memory import COOKIE_NAME, COOKIE_PATH
from app.main import app

BUYER = {"first_name": "João Pedro", "last_name": "da Silva", "email": "joao.silva@citi.org.br"}


@pytest.fixture()
def client():
    # sem o lifespan: a lembrança do comprador não usa banco nem provedor de pagamento
    return TestClient(app)


def test_nothing_remembered_returns_null(client):
    response = client.get("/api/comprador")
    assert response.status_code == 200
    assert response.json() is None
    assert response.headers["cache-control"] == "no-store"


def test_remembers_buyer_in_restricted_cookie(client):
    response = client.put("/api/comprador", json={**BUYER, "email": "  Joao.Silva@CITI.org.br "})
    assert response.status_code == 204
    cookie = response.headers["set-cookie"]
    assert f"{COOKIE_NAME}=" in cookie
    assert "HttpOnly" in cookie
    assert "SameSite=strict" in cookie
    assert f"Path={COOKIE_PATH}" in cookie
    assert "Max-Age=34560000" in cookie
    # nada de nome ou e-mail legível no cabeçalho
    assert "citi.org.br" not in cookie and "Silva" not in cookie

    remembered = client.get("/api/comprador")
    assert remembered.json() == BUYER
    # cada visita renova o prazo
    assert f"{COOKIE_NAME}=" in remembered.headers["set-cookie"]


def test_cookie_is_secure_over_https():
    response = TestClient(app, base_url="https://loja.test").put("/api/comprador", json=BUYER)
    assert "Secure" in response.headers["set-cookie"]


def test_latest_buyer_replaces_previous(client):
    client.put("/api/comprador", json=BUYER)
    other = {"first_name": "Ana", "last_name": "Souza", "email": "ana@gmail.com"}
    client.put("/api/comprador", json=other)
    assert client.get("/api/comprador").json() == other


@pytest.mark.parametrize(
    "payload",
    [
        {**BUYER, "email": "sem-arroba"},
        {**BUYER, "first_name": ""},
        {**BUYER, "first_name": "x" * 41},
        {**BUYER, "last_name": "y" * 40},
        {**BUYER, "first_name": "Ana\nMaria"},
        {**BUYER, "member": True},
    ],
)
def test_rejects_invalid_buyer(client, payload):
    assert client.put("/api/comprador", json=payload).status_code == 422
    assert client.get("/api/comprador").json() is None


def test_names_fit_buyer_name_column(client):
    longest = {"first_name": "N" * 40, "last_name": "S" * 39, "email": "a@b.co"}
    assert client.put("/api/comprador", json=longest).status_code == 204
    remembered = client.get("/api/comprador").json()
    assert len(f"{remembered['first_name']} {remembered['last_name']}") == 80


@pytest.mark.parametrize("value", ["%%%", base64.urlsafe_b64encode(b'{"first_name":"A"}').decode(), "bm90LWpzb24"])
def test_corrupted_cookie_is_forgotten(client, value):
    client.cookies.set(COOKIE_NAME, value, path=COOKIE_PATH)
    response = client.get("/api/comprador")
    assert response.status_code == 200
    assert response.json() is None
    assert f'{COOKIE_NAME}=""' in response.headers["set-cookie"]
