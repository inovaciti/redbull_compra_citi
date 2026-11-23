// Gabinete do Mini Cooler 3D: carrega o motor do kit (cooler/geladeira/cooler-engine.js,
// que traz o próprio Three.js, a câmera, a órbita e o pós-processamento) e aplica as
// artes e os acabamentos do kit. Lógica portada de `geladeira/cooler.mjs` do
// Kit_Mini_Cooler_3D (classe CoolerViewer), sem mudança de comportamento.

const ENGINE_URL = new URL('../../cooler/geladeira/cooler-engine.js', import.meta.url).href;
// artes do kit em WebP sem perda (mesmos pixels dos PNGs originais, ~35% menores)
const art = (name) => new URL(`../../cooler/geladeira/art/${name}.webp`, import.meta.url).href;
const DECALS = {
  sideLeft: art('decalSideLeft'),
  sideRight: art('decalSideRight'),
  top: art('decalTop'),
  glass: art('decalGlass'),
};
const FRONT_WORDMARK = art('frontWordmark');

let engine;

/** Injeta o motor uma única vez (script clássico que define window.CoolerEngine). */
export function loadEngine() {
  return engine ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = ENGINE_URL;
    script.onload = () => (window.CoolerEngine ? resolve(window.CoolerEngine) : reject(new Error('Motor do cooler indisponível.')));
    script.onerror = () => reject(new Error('Falha ao carregar o motor do cooler.'));
    document.head.append(script);
  }).catch((error) => {
    engine = undefined;
    throw error;
  });
}

/** Espera a GPU terminar o primeiro quadro, para a geladeira aparecer já completa. */
export async function waitForFrame(renderer) {
  const gl = renderer.getContext();
  if (gl.isContextLost()) throw new Error('O navegador perdeu o contexto WebGL.');
  if (!gl.fenceSync) return;
  const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  if (!fence) throw new Error('O navegador não conseguiu preparar o primeiro quadro.');
  gl.flush();
  try {
    let result;
    do {
      await new Promise(requestAnimationFrame);
      result = gl.clientWaitSync(fence, 0, 0);
    } while (result === gl.TIMEOUT_EXPIRED);
    if (result === gl.WAIT_FAILED || gl.isContextLost()) {
      throw new Error('O navegador não conseguiu renderizar o primeiro quadro.');
    }
  } finally {
    gl.deleteSync(fence);
  }
}

const isTopLogo = (mesh) => mesh.geometry?.parameters.width === 0.1 && mesh.geometry?.parameters.height === 0.03125;

/**
 * Aplica artes e acabamentos ao gabinete montado pelo motor.
 * @returns {Promise<{ dispose(): void }>} libera texturas, materiais e geometrias criados aqui
 */
export async function finishCabinet(api) {
  const resources = [];
  const { cooler } = api.debug;
  try {
    finishSideArt(api);
    const artwork = api.setDecals(DECALS);
    await Promise.all([
      artwork.then(() => finishRightSide(api)),
      artwork.then(() => lightFrontArt(api, resources)),
      addFrontWordmark(api, cooler, resources),
    ]);
  } catch (error) {
    for (const resource of resources) resource.dispose();
    throw error;
  }
  return {
    dispose() {
      for (const resource of resources) resource.dispose();
      resources.length = 0;
    },
  };
}

async function addFrontWordmark(api, cooler, resources) {
  const front = cooler.root.getObjectByName('FrontLogos');
  const glassArt = front.children.find((mesh) => mesh.geometry?.parameters.width > 0.3);
  const image = new Image();
  image.src = FRONT_WORDMARK;
  await image.decode();

  const map = new glassArt.material.map.constructor(image);
  map.colorSpace = glassArt.material.map.colorSpace;
  map.anisotropy = glassArt.material.map.anisotropy;
  const material = new glassArt.material.constructor({ map, transparent: true, depthWrite: false, toneMapped: false });
  const wordmark = new glassArt.constructor(glassArt.geometry, material);
  wordmark.name = 'FrontRedBullWordmark';
  wordmark.position.copy(glassArt.position);
  wordmark.position.z += 0.0001;
  wordmark.renderOrder = glassArt.renderOrder + 1;
  front.add(wordmark);
  resources.push(map, material);
  api.debug.render();
}

// faixa polida da lateral: a arte impressa fica por cima, o metal escovado aparece fora dela
function finishSideArt(api) {
  const frontLogos = api.debug.cooler.root.getObjectByName('FrontLogos');
  const topLogo = frontLogos.children.find(isTopLogo);
  if (topLogo) {
    // encaixa o logotipo entre o LED e o vidro sem distorcer a arte
    topLogo.scale.set(1.2, 1.2, 1);
    topLogo.position.x = 0;
    topLogo.position.y -= 0.004;
    topLogo.renderOrder = 8;
  }

  const body = api.debug.cooler.root.getObjectByName('MetalBody');
  const side = body.material[1];
  side.clearcoat = 0.65;
  side.onBeforeCompile = (shader) => {
    shader.fragmentShader = `
      float polishedBand(vec2 uv) {
        float down = 1.0 - uv.y;
        float rear = 0.0157455 + 0.3770331 * down;
        float front = 0.5384625 + 0.4526681 * down;
        return step(rear, uv.x) * step(uv.x, front);
      }
    ` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
      #include <map_fragment>
      #if defined(USE_MAP) && defined(USE_METALNESSMAP)
        float inkAlpha = 1.0 - texture2D(metalnessMap, vMetalnessMapUv).b;
        float band = polishedBand(vMapUv);
        float grain = fract(sin(floor(vMapUv.x * 3200.0) * 12.9898) * 43758.5453);
        vec3 bareSilver = vec3(0.55, 0.57, 0.60) * (1.0 - (1.0-band) * grain * 0.035);
        diffuseColor.rgb = mix(bareSilver, diffuseColor.rgb, inkAlpha);
      #endif
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `
      #include <roughnessmap_fragment>
      #if defined(USE_MAP) && defined(USE_METALNESSMAP)
        float inkRoughnessAlpha = 1.0 - texture2D(metalnessMap, vMetalnessMapUv).b;
        float finishRoughness = mix(0.42, 0.16, polishedBand(vMapUv));
        roughnessFactor = mix(finishRoughness, roughnessFactor, inkRoughnessAlpha);
      #endif
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_physical_fragment>', `
      #include <lights_physical_fragment>
      #if defined(USE_CLEARCOAT) && defined(USE_MAP)
        material.clearcoat = 0.65 * polishedBand(vMapUv);
        material.clearcoatRoughness = 0.12;
      #endif
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <colorspace_fragment>', `
      #include <colorspace_fragment>
      #if defined(USE_MAP) && defined(USE_METALNESSMAP)
        float printCoverage = 1.0 - texture2D(metalnessMap, vMetalnessMapUv).b;
        vec3 printColor = linearToOutputTexel(vec4(texture2D(map, vMapUv).rgb, 1.0)).rgb;
        float printFidelity = 0.92;
        if (printColor.g > printColor.r * 1.5 && printColor.g > printColor.b * 1.1) {
          printColor = vec3(20.0, 33.0, 110.0) / 255.0;
          printFidelity = 1.0;
        }
        gl_FragColor.rgb = mix(gl_FragColor.rgb, printColor, printCoverage * printFidelity);
        float seamDown = 1.0 - vMapUv.y;
        float rearDistance = vMapUv.x - (0.0157455 + 0.3770331 * seamDown);
        float frontDistance = vMapUv.x - (0.5384625 + 0.4526681 * seamDown);
        float seamDistance = abs(rearDistance) < abs(frontDistance) ? rearDistance : frontDistance;
        float seamPixel = max(fwidth(vMapUv.x) * 0.7, 0.0005);
        float seamHighlight = exp(-pow((seamDistance + seamPixel * 0.35) / (seamPixel * 0.45), 2.0));
        float seamShadow = exp(-pow((seamDistance - seamPixel * 0.7) / (seamPixel * 0.65), 2.0));
        gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb * (1.0 - seamShadow * 0.22) + seamHighlight * 0.12, 1.0-printCoverage);
      #endif
    `);
  };
  side.customProgramCacheKey = () => 'left-side-aligned-polished-band-v2';
  side.needsUpdate = true;
  api.debug.render();
}

// lateral direita: espelha o acabamento inteiro, mantendo a arte e as duas emendas junto da porta
function finishRightSide(api) {
  const body = api.debug.cooler.root.getObjectByName('MetalBody');
  const left = body.material[1];
  const right = body.material[0];
  for (const texture of new Set([right.map, right.roughnessMap, right.metalnessMap])) {
    if (!texture) continue;
    texture.repeat.x = -1;
    texture.offset.x = 1;
    texture.updateMatrix();
  }
  right.clearcoat = left.clearcoat;
  right.onBeforeCompile = left.onBeforeCompile;
  right.customProgramCacheKey = () => 'right-side-aligned-polished-band-v2';
  right.needsUpdate = true;
  api.debug.render();
}

// contorno do logotipo frontal aceso pelo LED: máscara amarela + halo desfocado
function lightFrontArt(api, resources) {
  const { cooler } = api.debug;
  const front = cooler.root.getObjectByName('FrontLogos');
  const logo = front.children.find(isTopLogo);
  if (!logo?.visible || !logo.material.map) return;
  const source = logo.material.map.image;
  const mask = document.createElement('canvas');
  mask.width = source.width;
  mask.height = source.height;
  const context = mask.getContext('2d');
  if (!context) return;
  context.drawImage(source, 0, 0);
  const pixels = context.getImageData(0, 0, mask.width, mask.height);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const red = pixels.data[i];
    const green = pixels.data[i + 1];
    const blue = pixels.data[i + 2];
    const contour = red > 150 && blue > 100 && green < red * 0.45 && red > blue * 0.65;
    pixels.data[i] = 252;
    pixels.data[i + 1] = 195;
    pixels.data[i + 2] = 10;
    if (!contour || pixels.data[i + 3] < 48) pixels.data[i + 3] = 0;
  }
  context.putImageData(pixels, 0, 0);
  const padding = 40;
  const halo = document.createElement('canvas');
  halo.width = mask.width + padding * 2;
  halo.height = mask.height + padding * 2;
  const glow = halo.getContext('2d');
  if (!glow) return;
  glow.globalCompositeOperation = 'lighter';
  for (const [blur, opacity] of [[26, 0.4], [9, 0.65], [2.5, 0.7]]) {
    glow.filter = `blur(${blur}px)`;
    glow.globalAlpha = opacity;
    glow.drawImage(mask, padding, padding);
  }
  const ledFrame = cooler.root.getObjectByName('BlueLEDFrame');
  const originalHalo = ledFrame.children.find((node) => node.material?.map);
  const addLayer = (canvas, opacity, expanded, order) => {
    const texture = new logo.material.map.constructor(canvas);
    texture.colorSpace = logo.material.map.colorSpace;
    texture.anisotropy = logo.material.map.anisotropy;
    const material = originalHalo.material.clone();
    material.map = texture;
    material.opacity = opacity;
    const geometry = logo.geometry.clone();
    const mesh = new logo.constructor(geometry, material);
    mesh.name = expanded ? 'FrontArtworkLEDHalo' : 'FrontArtworkLEDCore';
    mesh.position.copy(logo.position);
    mesh.position.z += expanded ? 0.00005 : 0.0001;
    mesh.scale.copy(logo.scale);
    if (expanded) {
      mesh.scale.x *= halo.width / mask.width;
      mesh.scale.y *= halo.height / mask.height;
    }
    mesh.renderOrder = order;
    front.add(mesh);
    resources.push(texture, material, geometry);
  };
  addLayer(halo, 1.1, true, 7);
  addLayer(mask, 0.65, false, 9);
  api.debug.render();
}
