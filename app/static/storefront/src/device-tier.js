// Quanto de geladeira 3D este aparelho aguenta, decidido antes de baixar qualquer coisa dela
// (motor, latas e HDR somam dezenas de MB). Sem Three.js: só perguntas baratas ao navegador e
// um contexto WebGL de teste, fechado logo em seguida.
//
//   'full'  geladeira 3D com a qualidade que o motor escolher para a tela
//   'low'   geladeira 3D no nível mais leve do motor (resolução 1x, sem sombras)
//   'none'  sem 3D: fica a imagem da geladeira com o vidro embaçado (a do loading), e a loja
//           funciona igual. Celular muito antigo, GPU por software, economia de dados ou rede 2G.
//
// `?3d=0`, `?3d=low` e `?3d=1` forçam um modo (testes e suporte).

/** @typedef {'full' | 'low' | 'none'} SceneTier */

// GPUs que não sustentam a geladeira (cada lata tem ~120 mil triângulos e a cena usa bloom e
// transmissão de vidro): renderização por software e as gerações móveis mais antigas.
const SOFTWARE_GPU = /swiftshader|llvmpipe|softpipe|software|basic render/i;
const OLD_GPU = /mali-(?:[2-4]\d\d|t6\d\d|t7[0-5]\d)|adreno[^\d]*(?:[2-4]\d\d|50\d)|powervr sgx|videocore|vivante|tegra [2-4]\b/i;
const MIN_TEXTURE_SIZE = 4096;

const FORCED = { 0: 'none', low: 'low', 1: 'full' };

/**
 * Há WebGL (2 ou 1)? Testado uma vez por página (criar o contexto de teste custa dezenas de ms) e
 * usado também pela cena 3D, que não precisa testar de novo.
 */
let webgl;
export function supportsWebGL() {
  if (webgl === undefined) {
    try {
      const gl = document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl');
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
      webgl = !!gl;
    } catch {
      webgl = false;
    }
  }
  return webgl;
}

/** Abre um WebGL 2 de teste; `null` se não houver (ou se for lento demais, segundo o navegador). */
function probeGpu() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2', { failIfMajorPerformanceCaveat: true });
    if (!gl) return null;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = {
      renderer: String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)),
      maxTexture: Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)),
    };
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    webgl = true; // a cena 3D não precisa abrir outro contexto de teste
    return gpu;
  } catch {
    return null;
  }
}

/** @returns {SceneTier} */
export function sceneTier() {
  const forced = FORCED[new URLSearchParams(location.search).get('3d') ?? ''];
  if (forced) return forced;

  const connection = /** @type {any} */ (navigator).connection;
  if (connection?.saveData || /2g$/.test(connection?.effectiveType ?? '')) return 'none';
  if (matchMedia('(prefers-reduced-data: reduce)').matches) return 'none';
  const memory = /** @type {any} */ (navigator).deviceMemory; // GB, só no Chromium
  if (memory !== undefined && memory < 2) return 'none';

  const gpu = probeGpu();
  if (!gpu || SOFTWARE_GPU.test(gpu.renderer) || OLD_GPU.test(gpu.renderer) || gpu.maxTexture < MIN_TEXTURE_SIZE) return 'none';

  // aparelho fraco que ainda roda 3D (o Safari não informa memória nem núcleos de verdade:
  // iPhone segue na qualidade completa, que ele aguenta)
  if ((memory !== undefined && memory <= 2) || navigator.hardwareConcurrency <= 2) return 'low';
  return 'full';
}
