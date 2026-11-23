"""Entrega dos arquivos da loja: versão na URL, cache longo e gzip pré-calculado.

A loja é servida sem etapa de build. Para o navegador poder guardar os arquivos
para sempre, a página aponta para ``/static/v/<versão>/storefront/...``: a versão
é um hash de caminho, tamanho e data de todos os arquivos da loja, então qualquer
arquivo alterado muda a URL sozinho. Como os módulos se importam por caminho
relativo, todo o grafo herda a mesma versão. O conteúdo entregue é byte a byte o
mesmo do disco; só muda como ele viaja (comprimido e com cache).
"""

import gzip
import hashlib
import mimetypes
import os
import tempfile
import threading
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, Response

BASE_DIR = Path(__file__).resolve().parent
STOREFRONT_DIR = BASE_DIR / "static" / "storefront"
STORE_HTML = BASE_DIR / "templates" / "loja.html"
STATIC_PREFIX = "/static/storefront/"
VERSIONED_ROOT = "/static/v"

# Texto e binários que comprimem bem; imagens, fontes e PNGs já vêm comprimidos.
COMPRESSIBLE = {".js", ".mjs", ".css", ".json", ".glb", ".hdr", ".svg", ".txt"}
# Código 3D: fica fora do modulepreload. Ele é importado sob demanda logo depois que a
# interface aparece (medido: pré-carregá-lo no HTML atrasava a interface em ~240 ms).
SCENE_PARTS = ("src/scene/", "vendor/three/", "vendor/gsap/")
# Exceção: o enquadramento da geladeira não usa Three.js e a interface precisa dele já no
# loading (onde a geladeira vai pousar antes de o 3D carregar).
UI_SCENE_MODULES = ("src/scene/cooler-frame.js",)
GZIP_DIR = Path(tempfile.gettempdir()) / "redbull-pdv-gzip"

IMMUTABLE = "public, max-age=31536000, immutable"

_version_lock = threading.Lock()
_version_cache: tuple[tuple, str] | None = None


def _snapshot() -> tuple:
    """Caminho, tamanho e data de cada arquivo da loja (barato: só stat)."""
    entries = []
    for root, _dirs, files in os.walk(STOREFRONT_DIR):
        for name in files:
            path = Path(root, name)
            stat = path.stat()
            entries.append((str(path.relative_to(STOREFRONT_DIR)), stat.st_size, stat.st_mtime_ns))
    entries.sort()
    return tuple(entries)


def asset_version() -> str:
    """Versão atual dos arquivos da loja (muda quando qualquer arquivo muda)."""
    global _version_cache
    snapshot = _snapshot()
    with _version_lock:
        if _version_cache and _version_cache[0] == snapshot:
            return _version_cache[1]
        digest = hashlib.sha256(repr(snapshot).encode()).hexdigest()[:12]
        _version_cache = (snapshot, digest)
        return digest


def _modulepreloads(base: str) -> str:
    """``<link rel="modulepreload">`` para o grafo de módulos da interface."""
    links = []
    for path in sorted(STOREFRONT_DIR.rglob("*.js")):
        rel = path.relative_to(STOREFRONT_DIR).as_posix()
        if not rel.startswith("src/") or (rel.startswith(SCENE_PARTS) and rel not in UI_SCENE_MODULES):
            continue  # o motor do kit (cooler/) é script clássico; a cena 3D vem sob demanda
        links.append(f'  <link rel="modulepreload" href="{base}{rel}">')
    return "\n".join(links)


_html_lock = threading.Lock()
_html_cache: tuple[tuple, str] | None = None


def render_store_html() -> str:
    """HTML da loja apontando para a versão atual dos arquivos."""
    global _html_cache
    version = asset_version()
    stat = STORE_HTML.stat()
    key = (version, stat.st_size, stat.st_mtime_ns)
    with _html_lock:
        if _html_cache and _html_cache[0] == key:
            return _html_cache[1]
        base = f"{VERSIONED_ROOT}/{version}/storefront/"
        html = STORE_HTML.read_text(encoding="utf-8")
        html = html.replace("<!-- modulepreload -->", _modulepreloads(base))
        html = html.replace(STATIC_PREFIX, base)
        _html_cache = (key, html)
        return html


def _resolve(asset_path: str) -> Path:
    path = (STOREFRONT_DIR / asset_path).resolve()
    if not path.is_relative_to(STOREFRONT_DIR) or not path.is_file():
        raise HTTPException(404, "Arquivo não encontrado")
    return path


def _gzip_copy(path: Path) -> Path:
    """Cópia gzip do arquivo, criada uma vez por conteúdo (tamanho + data)."""
    stat = path.stat()
    key = hashlib.sha256(f"gz2|{path}|{stat.st_size}|{stat.st_mtime_ns}".encode()).hexdigest()[:24]
    target = GZIP_DIR / f"{key}.gz"
    if not target.exists():
        GZIP_DIR.mkdir(parents=True, exist_ok=True)
        partial = target.with_suffix(f".{os.getpid()}.{threading.get_ident()}.tmp")
        with open(path, "rb") as source, open(partial, "wb") as raw:
            # sem nome nem data no cabeçalho: a cópia depende só do conteúdo
            with gzip.GzipFile(filename="", mode="wb", compresslevel=9, fileobj=raw, mtime=0) as out:
                while chunk := source.read(1 << 20):
                    out.write(chunk)
        os.replace(partial, target)
    return target


def warm_gzip_cache() -> None:
    """Pré-calcula as cópias gzip (roda em segundo plano ao subir o servidor)."""
    for path in STOREFRONT_DIR.rglob("*"):
        if path.is_file() and path.suffix.lower() in COMPRESSIBLE:
            try:
                _gzip_copy(path)
            except OSError:
                pass  # sem disco para o cache: o arquivo segue sendo servido sem compressão


router = APIRouter(include_in_schema=False)


@router.get(VERSIONED_ROOT + "/{version}/storefront/{asset_path:path}")
def versioned_asset(version: str, asset_path: str, request: Request) -> Response:
    # A versão só serve para quebrar o cache: o arquivo sai sempre do disco atual.
    path = _resolve(asset_path)
    media_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    headers = {"Cache-Control": IMMUTABLE, "Vary": "Accept-Encoding", "X-Content-Type-Options": "nosniff"}
    accepts_gzip = "gzip" in request.headers.get("accept-encoding", "").lower()
    if accepts_gzip and path.suffix.lower() in COMPRESSIBLE:
        try:
            compressed = _gzip_copy(path)
        except OSError:
            compressed = None
        if compressed is not None:
            headers["Content-Encoding"] = "gzip"
            return FileResponse(compressed, media_type=media_type, headers=headers)
    return FileResponse(path, media_type=media_type, headers=headers)
