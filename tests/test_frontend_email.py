from pathlib import Path


ROOT = Path(__file__).parents[1]


def test_repository_has_no_local_or_fixed_payer_fallback():
    sources = "\n".join(
        path.read_text()
        for path in [
            *sorted((ROOT / "app" / "static" / "storefront" / "src").rglob("*.js")),
            ROOT / "app" / "payments.py",
            ROOT / "app" / "config.py",
        ]
    )
    assert "vendas@citi.local" not in sources
    assert "MERCADOPAGO_FALLBACK_PAYER_EMAIL" not in sources
    assert "MERCADOPAGO_TEST_PAYER_EMAIL" not in sources
    assert "MERCADOPAGO_TEST_PAYER_FIRST_NAME" not in sources
