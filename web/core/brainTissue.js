// The Brain's tissue (decoration, identical for every image): folded hemispheres, cerebellum, brainstem.
// The geometry is built once, in a Web Worker (brainTissueBuild.js); this module turns it into one mesh with one
// soft-lit plum material, and adds a glow under the cortex along the top-1 path (and the focused path).
import * as THREE from 'three';
import { INFERNO_GLSL, infernoTexture } from './inferno.js';

export const TISSUE = {
  color: 0x74345f,           // dark plum crowns (sRGB); sulci are darkened by the baked cavity colours
  roughness: 0.62,
  sheen: 0.6,
  sheenColor: 0xb89ad8,      // lavender bounce at grazing angles
  sheenRoughness: 0.42,
  clearcoat: 0.1,            // a thin wet layer: satin highlights on the gyrus crowns
  clearcoatRoughness: 0.5,
  glowRadius: 0.55,          // under-cortex path glow falloff (world units)
  glowStrength: 0.9,
};

/** Tissue geometry from the worker (or built here if workers are unavailable). */
async function loadGeometryArrays() {
  try {
    const worker = new Worker(new URL('./brainTissueWorker.js', import.meta.url), { type: 'module' });
    const arrays = await new Promise((resolve, reject) => {
      worker.onmessage = (e) => resolve(e.data);
      worker.onerror = (e) => reject(e);
      worker.postMessage('build');
    });
    worker.terminate();
    return arrays;
  } catch (err) {
    console.warn('[stark] tissue worker failed; building on the main thread', err?.message ?? err);
    const { buildTissueArrays } = await import('./brainTissueBuild.js');
    return buildTissueArrays();
  }
}

// ---------------------------------------------------------------------------------------------------- material
const MAX_PATH = 48;

export async function createTissue() {
  const g = await loadGeometryArrays();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(g.position, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(g.normal, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(g.color, 3));
  geometry.setIndex(new THREE.BufferAttribute(g.index, 1));
  geometry.computeBoundingSphere();
  const material = new THREE.MeshPhysicalMaterial({
    color: TISSUE.color, vertexColors: true, roughness: TISSUE.roughness, metalness: 0,
    sheen: TISSUE.sheen, sheenColor: TISSUE.sheenColor, sheenRoughness: TISSUE.sheenRoughness,
    clearcoat: TISSUE.clearcoat, clearcoatRoughness: TISSUE.clearcoatRoughness,
  });
  const glow = {
    uInferno: { value: infernoTexture },
    uPath: { value: Array.from({ length: MAX_PATH }, () => new THREE.Vector3()) },
    uPathCount: { value: 0 },
    uFocusPath: { value: Array.from({ length: MAX_PATH }, () => new THREE.Vector3()) },
    uFocusCount: { value: 0 },
    uGlow: { value: 0 },
    uTime: { value: 0 },
    uGlowRadius: { value: TISSUE.glowRadius },
    uGlowStrength: { value: TISSUE.glowStrength },
  };
  // The glow is evaluated per vertex (the mesh is dense enough for a 0.55-wide falloff) and interpolated:
  // per fragment, the path-distance loops cost the M1 a third of its frame time at 1440p.
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, glow);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
uniform vec3 uPath[${MAX_PATH}];
uniform int uPathCount;
uniform vec3 uFocusPath[${MAX_PATH}];
uniform int uFocusCount;
uniform float uGlow;
uniform float uGlowRadius;
varying float vGlow;
varying float vFocusGlow;
float segDist(vec3 p, vec3 a, vec3 b) {
  vec3 ab = b - a;
  float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
  return length(p - a - ab * t);
}
float pathDist(vec3 p, vec3 pts[${MAX_PATH}], int n) {
  float d = 1e3;
  for (int i = 0; i < ${MAX_PATH - 1}; i++) {
    if (i >= n - 1) break;
    d = min(d, segDist(p, pts[i], pts[i + 1]));
  }
  return d;
}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vGlow = 0.0;
vFocusGlow = 0.0;
if (uGlow > 0.0) {
  float r2 = uGlowRadius * uGlowRadius;
  float d = pathDist(position, uPath, uPathCount);
  vGlow = exp(-d * d / r2);
  if (uFocusCount > 1) { float f = pathDist(position, uFocusPath, uFocusCount); vFocusGlow = exp(-f * f / r2); }
}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uGlow;
uniform float uTime;
uniform float uGlowStrength;
varying float vGlow;
varying float vFocusGlow;
${INFERNO_GLSL}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
// light from the selected vein scattering up through the cortex above it
totalEmissiveRadiance += (inferno(0.82) * vGlow * (0.85 + 0.15 * sin(uTime * 2.2)) + inferno(0.7) * vFocusGlow * 0.8)
  * uGlow * uGlowStrength;`);
  };
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 0;
  console.info(`[stark] brain tissue: ${g.vertices} vertices, built in ${g.ms.toFixed(0)} ms`);

  const setPts = (arr, pts) => {
    const n = Math.min(MAX_PATH, pts?.length ?? 0);
    for (let i = 0; i < n; i++) arr[i].copy(pts[i]);
    return n;
  };
  return {
    mesh,
    material,
    buildMs: g.ms,
    /** Points (brain-root space) along the top-1 path, stem → leaf; null clears. */
    setPath(pts) { glow.uPathCount.value = setPts(glow.uPath.value, pts); },
    setFocusPath(pts) { glow.uFocusCount.value = setPts(glow.uFocusPath.value, pts); },
    /** 0..1: the glow follows the strand reveal. */
    setGlow(k) { glow.uGlow.value = k; },
    update(time) { glow.uTime.value = time; },
  };
}

/** Soft directional light for the tissue (only the tissue is lit; everything else is self-coloured). */
export function createTissueLights(target) {
  const group = new THREE.Group();
  const key = new THREE.DirectionalLight(0xffe9dc, 2.9);          // warm key, upper front-left of the view
  key.position.set(-8, 16, 12);
  const rim = new THREE.DirectionalLight(0xa9b8ff, 1.6);          // cool rim from behind, for the silhouette
  rim.position.set(6, 9, -12);
  const under = new THREE.DirectionalLight(0x9b86d6, 0.7);        // lavender bounce on the undersides
  under.position.set(2, -8, 6);
  const fill = new THREE.HemisphereLight(0x9d8cc0, 0x2a0f24, 0.42);
  for (const l of [key, rim, under]) { l.target.position.copy(target); group.add(l, l.target); }
  group.add(fill);
  return group;
}
