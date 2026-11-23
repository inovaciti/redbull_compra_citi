# Bibliotecas e fontes de terceiros da loja

| Item | Versão | Licença | Local |
| --- | --- | --- | --- |
| Three.js | 0.160.0 | MIT | `app/static/storefront/vendor/three/` (licença em `vendor/three/LICENSE`) |
| Kit Mini Cooler 3D (motor, artes, latas GLB, HDR) | 1.0.0 | fornecido pelo projeto | `app/static/storefront/cooler/`; o motor embute Three.js r160 (MIT) e GSAP 3.12.5, com os avisos de licença no fim de `cooler-engine.js` |
| GSAP | 3.12.5 | GreenSock Standard "No Charge" License — https://gsap.com/standard-license | `app/static/storefront/vendor/gsap/` |
| Geist / Geist Mono | — | SIL Open Font License 1.1 | `app/static/storefront/assets/fonts/` (licenças em `assets/fonts/licenses/`) |
| Poppins | — | SIL Open Font License 1.1 | `app/static/storefront/assets/fonts/` (licença em `assets/fonts/licenses/`) |

Os arquivos em `vendor/three/addons/` (`GLTFLoader.js`, `RGBELoader.js`, `BufferGeometryUtils.js`) são cópias de `three@0.160.0/examples/jsm/` com apenas os caminhos de import alterados (`'three'` → `'../three.module.min.js'`, `'../utils/BufferGeometryUtils.js'` → `'./BufferGeometryUtils.js'`), para funcionar sem import map (que exigiria script inline, bloqueado pela CSP).

As fotos das latas e o logo em `assets/images/` foram fornecidos pelo projeto.
