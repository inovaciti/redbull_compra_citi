// Latas da geladeira. Cada sabor é um GLB do kit (cooler/latas/<id>/modelo.glb),
// carregado uma vez; a malha é agrupada por material e desenhada com instâncias,
// com os reflexos do HDR do kit. Cada lata tem também a própria pose (mesmas
// geometrias e materiais), oculta enquanto ela está parada na instância e visível
// enquanto se move. Carregamento, agrupamento e reflexos seguem `fonte/estoque.mjs`
// do Kit_Mini_Cooler_3D.

import * as THREE from '../../vendor/three/three.module.min.js';
import { GLTFLoader } from '../../vendor/three/addons/GLTFLoader.js';
import { RGBELoader } from '../../vendor/three/addons/RGBELoader.js';
import { deinterleaveGeometry, mergeGeometries } from '../../vendor/three/addons/BufferGeometryUtils.js';

const HDR_URL = new URL('../../cooler/latas/studio.hdr', import.meta.url).href;
const modelUrl = (id) => new URL(`../../cooler/latas/${id}/modelo.glb`, import.meta.url).href;

// lata slim de 250 ml do kit: Ø 53 mm × 134 mm, base em y = 0
const CAN_RADIUS = 0.0265;
export const CAN_HEIGHT = 0.134;
const MATRIX = new THREE.Matrix4();

// maior valor de cada tipo inteiro: o divisor que leva o inteiro normalizado de volta a [-1, 1]
const NORMALIZED_MAX = new Map([[Int8Array, 127], [Uint8Array, 255], [Int16Array, 32767], [Uint16Array, 65535]]);

/** Atributo em inteiros (normalizados ou não) → o mesmo atributo em float, num laço só. */
function toFloat(attribute) {
  const source = attribute.array;
  const max = attribute.normalized ? NORMALIZED_MAX.get(source.constructor) : 1;
  const values = new Float32Array(source.length);
  // inteiro com sinal normalizado: -32768 vira -1 (o mínimo é limitado, como no glTF)
  if (max === 1) values.set(source);
  else for (let i = 0; i < source.length; i++) values[i] = Math.max(source[i] / max, -1);
  return new THREE.BufferAttribute(values, attribute.itemSize);
}

// GLBs baixados e decodificados antes de o motor ficar pronto (prefetchCans); cada
// download é entregue uma única vez à biblioteca que o pedir
const gltfLoader = new GLTFLoader();
const prefetched = new Map();
const loadGltf = (id) => gltfLoader.loadAsync(modelUrl(id));

/** Começa a baixar e decodificar as latas destes sabores, em paralelo com o motor. */
export function prefetchCans(ids) {
  for (const id of ids) {
    if (prefetched.has(id)) continue;
    const pending = loadGltf(id);
    pending.catch(() => prefetched.delete(id));
    prefetched.set(id, pending);
  }
}

// reflexo das latas: o HDR também começa a baixar antes de o motor ficar pronto
let prefetchedHdr = null;
/** Começa a baixar o HDR dos reflexos, em paralelo com o motor. */
export function prefetchEnvironment() {
  prefetchedHdr ??= new RGBELoader().loadAsync(HDR_URL);
  prefetchedHdr.catch(() => { prefetchedHdr = null; });
}

function takeGltf(id) {
  const pending = prefetched.get(id);
  prefetched.delete(id);
  return pending ?? loadGltf(id);
}

function disposeMaterial(material, keep) {
  for (const value of Object.values(material)) {
    if (value?.isTexture && value !== keep) value.dispose();
  }
  material.dispose();
}

/**
 * @param {any} debug `api.debug` do motor (cria o ambiente de reflexo no renderizador dele)
 * @param {number} capacity quantas latas cabem na geladeira (máximo de instâncias por sabor)
 */
export async function createCanLibrary(debug, capacity) {
  const pendingHdr = prefetchedHdr ?? new RGBELoader().loadAsync(HDR_URL);
  prefetchedHdr = null;
  const hdr = await pendingHdr;
  let environment;
  try {
    environment = debug.createCanEnvironment(hdr);
  } finally {
    hdr.dispose();
  }

  const group = new THREE.Group();
  // alvos de toque: um cilindro invisível por lata (o raio não percorre a malha detalhada)
  const targets = new THREE.Group();
  targets.visible = false;
  group.add(targets);
  // O pipeline de render do motor só reescaneia as malhas da cena quando o objeto chamado
  // 'ImportedCans' muda ou muda o número de filhos dele. Malha fora da varredura fica com o
  // próprio material nas passadas especiais do motor: no brilho (bloom) a lata acordada vira
  // um borrão branco e nas passadas diretas é desenhada por cima do vidro. Por isso cada lata
  // que entra ou sai troca o marcador por um objeto novo e vazio: a identidade sempre muda,
  // mesmo quando uma lata entra e outra sai antes do mesmo quadro (um simples revezamento de
  // nome entre dois objetos voltava ao mesmo estado e o motor não reescaneava).
  group.name = 'Latas';
  targets.name = 'LatasAlvos';
  let marker = null;
  const rescan = () => {
    marker?.removeFromParent();
    marker = new THREE.Object3D();
    marker.name = 'ImportedCans';
    group.add(marker);
  };
  rescan();
  const targetGeometry = new THREE.CylinderGeometry(CAN_RADIUS, CAN_RADIUS, CAN_HEIGHT, 12).translate(0, CAN_HEIGHT / 2, 0);
  const targetMaterial = new THREE.MeshBasicMaterial();

  /** @type {Map<string, Promise<any>>} */
  const models = new Map();
  const cans = new Set();

  function build(gltf) {
    const source = gltf.scene;
    source.updateMatrixWorld(true);
    const base = new THREE.Box3().setFromObject(source).min.y;
    const byMaterial = new Map();
    const sourceGeometries = new Set();
    source.traverse((node) => {
      if (!node.isMesh) return;
      if (!byMaterial.has(node.material)) byMaterial.set(node.material, []);
      const geometry = node.geometry.clone();
      // alguns GLBs do kit vêm com atributos intercalados, que não podem ser unidos
      if (Object.values(geometry.attributes).some((attribute) => attribute.isInterleavedBufferAttribute)) deinterleaveGeometry(geometry);
      // as latas vêm com a malha em inteiros de 16 bits (KHR_mesh_quantization, metade do
      // download); de volta a float antes de aplicar a posição do nó, que tiraria os valores da
      // faixa do inteiro, e para todas as partes de um material poderem ser unidas
      for (const [name, attribute] of Object.entries(geometry.attributes)) {
        if (!(attribute.array instanceof Float32Array)) geometry.setAttribute(name, toFloat(attribute));
      }
      geometry.applyMatrix4(node.matrixWorld).translate(0, -base, 0);
      byMaterial.get(node.material).push(geometry);
      sourceGeometries.add(node.geometry);
    });
    for (const geometry of sourceGeometries) geometry.dispose();

    const parts = [];
    for (const [material, geometries] of byMaterial) {
      const merged = geometries.length > 1 && mergeGeometries(geometries);
      if (merged) geometries.forEach((geometry) => geometry.dispose());
      material.envMap = environment.texture;
      for (const geometry of merged ? [merged] : geometries) parts.push({ geometry, material });
    }
    // Só as latas paradas ficam nas instâncias, sempre contíguas em [0, count): a GPU processa
    // apenas as que existem. (Instância vazia não gera pixel, mas a geometria dela, ~116 mil
    // triângulos, passaria pelos vértices em cada uma das passadas do motor, em cada quadro.)
    const batches = parts.map(({ geometry, material }) => {
      const batch = new THREE.InstancedMesh(geometry, material, capacity);
      batch.name = material.name || geometry.name;
      batch.castShadow = true;
      batch.receiveShadow = true;
      batch.frustumCulled = false; // as instâncias se movem; a esfera de culling não acompanharia
      batch.count = 0;
      group.add(batch);
      return batch;
    });
    return { parts, batches, resting: [] };
  }

  /** Põe a lata (ou atualiza a pose dela) nas instâncias do sabor. */
  function place(can, matrix) {
    const { batches, resting } = can.model;
    if (can.instance < 0) {
      can.instance = resting.length;
      resting.push(can);
    }
    for (const batch of batches) {
      batch.setMatrixAt(can.instance, matrix);
      batch.count = resting.length;
      batch.instanceMatrix.needsUpdate = true;
    }
  }

  /** Tira a lata das instâncias; a última ocupa o lugar dela, para não deixar buraco. */
  function unplace(can) {
    if (can.instance < 0) return;
    const { batches, resting } = can.model;
    const last = resting.pop();
    if (last !== can) {
      resting[can.instance] = last;
      for (const batch of batches) {
        batch.getMatrixAt(last.instance, MATRIX);
        batch.setMatrixAt(can.instance, MATRIX);
      }
      last.instance = can.instance;
    }
    can.instance = -1;
    for (const batch of batches) {
      batch.count = resting.length;
      batch.instanceMatrix.needsUpdate = true;
    }
  }

  return {
    group,
    targets,

    /** Carrega (uma vez) o modelo do sabor. */
    model(id) {
      if (!models.has(id)) {
        models.set(id, takeGltf(id).then(build).catch((error) => {
          models.delete(id);
          throw error;
        }));
      }
      return models.get(id);
    },

    /**
     * Cria uma lata parada na pose indicada (coordenadas do grupo das latas).
     * @returns {{ model: any, instance: number, pose: THREE.Group, target: THREE.Mesh, awake: boolean, flavor: number }}
     */
    add(model, flavor, { x, y, z, yaw }) {
      if (model.resting.length >= capacity) throw new RangeError('Sem instância livre para a lata.');
      const pose = new THREE.Group();
      pose.position.set(x, y, z);
      pose.rotation.y = yaw;
      pose.visible = false;
      for (const part of model.parts) {
        const mesh = new THREE.Mesh(part.geometry, part.material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        pose.add(mesh);
      }
      group.add(pose);
      rescan();
      const target = new THREE.Mesh(targetGeometry, targetMaterial);
      const can = { model, instance: -1, pose, target, awake: false, flavor };
      target.userData.can = can;
      targets.add(target);
      cans.add(can);
      this.rest(can);
      return can;
    },

    /** Tira a lata da instância para animá-la como objeto próprio. Devolve a pose (o que se anima). */
    wake(can) {
      if (can.awake) return can.pose;
      can.pose.visible = true;
      unplace(can);
      can.awake = true;
      return can.pose;
    },

    /** Lata parada: volta para a instância na pose atual. */
    rest(can) {
      can.pose.updateMatrix();
      place(can, can.pose.matrix);
      can.pose.visible = false;
      can.awake = false;
      this.track(can);
    },

    /** Atualiza o alvo de toque com a pose atual da lata. */
    track(can) {
      can.target.position.copy(can.pose.position);
    },

    /** A lata deixa de responder ao toque (está saindo da geladeira). */
    untarget(can) {
      can.target.removeFromParent();
    },

    /** Remove a lata (saiu da geladeira). */
    remove(can) {
      unplace(can);
      can.pose.removeFromParent();
      can.target.removeFromParent();
      cans.delete(can);
      rescan();
    },

    /** Lata sob o raio e a distância até ela, ou null. */
    hit(raycaster) {
      targets.updateMatrixWorld(true);
      const hit = raycaster.intersectObjects(targets.children, false)[0];
      return hit ? { can: hit.object.userData.can, distance: hit.distance } : null;
    },

    dispose() {
      group.removeFromParent();
      for (const can of cans) can.pose.removeFromParent();
      cans.clear();
      const seen = new Set();
      for (const pending of models.values()) {
        pending.then((model) => {
          for (const batch of model.batches) batch.dispose();
          for (const { geometry, material } of model.parts) {
            geometry.dispose();
            if (!seen.has(material)) {
              seen.add(material);
              disposeMaterial(material, environment.texture);
            }
          }
        }, () => {});
      }
      models.clear();
      targetGeometry.dispose();
      targetMaterial.dispose();
      environment.dispose();
    },
  };
}
