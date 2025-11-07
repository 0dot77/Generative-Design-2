// boids.js - Boids 시뮬레이션 시스템
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as BufferGeometryUtils from "three/addons/utils/BufferGeometryUtils.js";

// Boids 파라미터
const CONFIG = {
  count: 120,
  maxSpeed: 10.0,
  maxForce: 3.5,
  neighborRadius: 8.0,
  separationRadius: 3.0,
  alignWeight: 0.8,
  cohesionWeight: 0.55,
  separationWeight: 1.2,
  boundMargin: 4.0,
  boundSteer: 0.08,
  hover: 2.4,
  scale: 1.0,
  // 표면 추종 파라미터
  surfHeightLerp: 0.3,
  surfHover: 0.6,
  surfSlide: 0.9,
};

// 상태
let _boidInst = null;
const _pos = [];
const _vel = [];
const _acc = [];
const _dummyObj = new THREE.Object3D();
let _terrain = null;

/* ========================= 
 * 지오메트리 유틸리티
 * ========================= */
function ensureUV(geom) {
  if (geom.getAttribute("uv")) return geom;
  geom.computeBoundingBox();
  const bb = geom.boundingBox;
  const size = new THREE.Vector3();
  bb.getSize(size);
  const pos = geom.getAttribute("position");
  const uvArr = new Float32Array(pos.count * 2);
  const invX = size.x > 1e-6 ? 1.0 / size.x : 1.0;
  const invZ = size.z > 1e-6 ? 1.0 / size.z : 1.0;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i),
      z = pos.getZ(i);
    uvArr[i * 2 + 0] = (x - bb.min.x) * invX;
    uvArr[i * 2 + 1] = (z - bb.min.z) * invZ;
  }
  geom.setAttribute("uv", new THREE.BufferAttribute(uvArr, 2));
  return geom;
}

function toNonIndexedWithUV(g) {
  const out = g.index ? g.toNonIndexed() : g.clone();
  if (!out.getAttribute("normal")) out.computeVertexNormals();
  return ensureUV(out);
}

function extractBaseGeometry(root) {
  let best = null;
  let bestCount = -1;
  root.traverse((o) => {
    if (!o.isMesh || o.isSkinnedMesh) return;
    const pos = o.geometry?.getAttribute?.("position");
    if (!pos) return;
    if (pos.count > bestCount) {
      best = o;
      bestCount = pos.count;
    }
  });
  if (!best) return null;
  return toNonIndexedWithUV(best.geometry);
}

function extractWholeGeometry(root) {
  root.updateWorldMatrix(true, true);
  const toRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const parts = [];
  root.traverse((o) => {
    if (!o.isMesh || o.isSkinnedMesh) return;
    const g0 = o.geometry;
    const pos = g0?.getAttribute?.("position");
    if (!pos) return;
    let g = toNonIndexedWithUV(g0).clone();
    const xf = new THREE.Matrix4().multiplyMatrices(toRoot, o.matrixWorld);
    g.applyMatrix4(xf);
    parts.push(g);
  });
  if (parts.length === 0) return null;
  const merged = BufferGeometryUtils.mergeGeometries(parts, false);
  const out = merged?.index ? merged.toNonIndexed() : merged;
  return ensureUV(out);
}

async function loadBoidGeometry() {
  const loader = new GLTFLoader();
  const CANDS = ["./assets/models/Datacolla_crypta.glb"];
  for (const url of CANDS) {
    try {
      const gltf = await new Promise((resolve, reject) =>
        loader.load(url, resolve, undefined, reject)
      );
      const gWhole = extractWholeGeometry(gltf.scene);
      if (gWhole) return gWhole;
      const gPart = extractBaseGeometry(gltf.scene);
      if (gPart) return gPart;
    } catch (e) {
      // try next
    }
  }
  // fallback
  const g = new THREE.ConeGeometry(0.35, 0.9, 8);
  g.rotateX(Math.PI * 0.5);
  return g.index ? g.toNonIndexed() : g;
}

/* ========================= 
 * Boids 알고리즘
 * ========================= */
function confineToTerrain(b, terrainSize, margin, steer) {
  const halfW = terrainSize.width * 0.5 - margin;
  const halfD = terrainSize.depth * 0.5 - margin;

  const ground =
    (_terrain.heightAtXZ(b.pos.x, b.pos.z) - _terrain.uniforms.seaLevel.value) *
    _terrain.uniforms.heightScale.value;
  const targetY = ground + CONFIG.hover;
  if (b.pos.y < targetY) {
    b.pos.y = targetY;
    if (b.vel.y < 0) b.vel.y *= -0.25;
  }

  const k = steer;
  if (Math.abs(b.pos.x) > halfW - margin)
    b.vel.x += -Math.sign(b.pos.x) * k;
  if (Math.abs(b.pos.z) > halfD - margin)
    b.vel.z += -Math.sign(b.pos.z) * k;

  if (b.pos.x < -halfW || b.pos.x > halfW) {
    b.pos.x = THREE.MathUtils.clamp(b.pos.x, -halfW, halfW);
    b.vel.x *= -1.0;
  }
  if (b.pos.z < -halfD || b.pos.z > halfD) {
    b.pos.z = THREE.MathUtils.clamp(b.pos.z, -halfD, halfD);
    b.vel.z *= -1.0;
  }
}

function followSurface(b, heightLerp, hoverWU, slideStrength) {
  const ground =
    (_terrain.heightAtXZ(b.pos.x, b.pos.z) - _terrain.uniforms.seaLevel.value) *
    _terrain.uniforms.heightScale.value;
  const targetY = ground + hoverWU;
  b.pos.y += (targetY - b.pos.y) * heightLerp;

  const n = _terrain.normalAtXZ(b.pos.x, b.pos.z);
  const dotVN = b.vel.x * n.x + b.vel.y * n.y + b.vel.z * n.z;
  const vt = new THREE.Vector3(
    b.vel.x - dotVN * n.x,
    b.vel.y - dotVN * n.y,
    b.vel.z - dotVN * n.z
  );
  b.vel.x += (vt.x - b.vel.x) * slideStrength;
  b.vel.y += (vt.y - b.vel.y) * slideStrength;
  b.vel.z += (vt.z - b.vel.z) * slideStrength;

  const g = new THREE.Vector3(0, -1, 0);
  const gDotN = g.dot(n);
  const gTan = g.clone().addScaledVector(n, -gDotN);
  const slope = Math.min(1.0, gTan.length());
  if (slope > 1e-4) {
    gTan.normalize();
    b.vel.addScaledVector(gTan, 0.25 * slideStrength * slope);
  }
}

function limitVec3(v, maxLen) {
  const s2 = v.lengthSq();
  if (s2 > maxLen * maxLen)
    v.multiplyScalar(maxLen / (Math.sqrt(s2) + 1e-6));
  return v;
}

function updateBoidsLogic(dt) {
  const N = CONFIG.count;
  for (let i = 0; i < N; i++) _acc[i].set(0, 0, 0);

  for (let i = 0; i < N; i++) {
    const pi = _pos[i];
    const vi = _vel[i];
    let sumV = new THREE.Vector3();
    let sumP = new THREE.Vector3();
    let sep = new THREE.Vector3();
    let cnt = 0;

    for (let j = 0; j < N; j++)
      if (j !== i) {
        const pj = _pos[j];
        const d = pi.distanceTo(pj);
        if (d < CONFIG.neighborRadius) {
          sumV.add(_vel[j]);
          sumP.add(pj);
          cnt++;
        }
        if (d < CONFIG.separationRadius && d > 1e-3)
          sep.add(pi.clone().sub(pj).multiplyScalar(1.0 / d));
      }

    const acc = _acc[i];
    if (cnt > 0) {
      const align = sumV.multiplyScalar(1 / cnt).setY(0);
      align
        .normalize()
        .multiplyScalar(CONFIG.maxSpeed)
        .sub(vi)
        .clampLength(0, CONFIG.maxForce);
      acc.addScaledVector(align, CONFIG.alignWeight);

      const center = sumP.multiplyScalar(1 / cnt);
      const cohesion = center.sub(pi).setY(0);
      cohesion
        .normalize()
        .multiplyScalar(CONFIG.maxSpeed)
        .sub(vi)
        .clampLength(0, CONFIG.maxForce);
      acc.addScaledVector(cohesion, CONFIG.cohesionWeight);
    }

    if (sep.lengthSq() > 0) {
      sep
        .normalize()
        .multiplyScalar(CONFIG.maxSpeed)
        .sub(vi)
        .clampLength(0, CONFIG.maxForce);
      acc.addScaledVector(sep, CONFIG.separationWeight);
    }

    acc.x += (Math.random() - 0.5) * 0.2;
    acc.z += (Math.random() - 0.5) * 0.2;
  }

  const terrainSize = { width: 200, depth: 200 };
  for (let i = 0; i < N; i++) {
    const p = _pos[i];
    const v = _vel[i];
    const a = _acc[i];
    v.addScaledVector(a, dt);
    confineToTerrain({ pos: p, vel: v }, terrainSize, CONFIG.boundMargin, CONFIG.boundSteer);
    followSurface(
      { pos: p, vel: v },
      CONFIG.surfHeightLerp,
      CONFIG.surfHover,
      CONFIG.surfSlide
    );
    limitVec3(v, CONFIG.maxSpeed);
    p.addScaledVector(v, dt);

    const yaw = Math.atan2(v.x, v.z);
    _dummyObj.position.copy(p);
    _dummyObj.rotation.set(0, yaw, 0);
    _dummyObj.scale.set(CONFIG.scale, CONFIG.scale, CONFIG.scale);
    _dummyObj.updateMatrix();
    _boidInst.setMatrixAt(i, _dummyObj.matrix);
  }
  _boidInst.instanceMatrix.needsUpdate = true;
}

/* ========================= 
 * 공개 API
 * ========================= */
export async function initBoids(scene, terrain) {
  if (!terrain) return false;
  _terrain = terrain;

  const geom = await loadBoidGeometry();
  const mat = new THREE.MeshStandardMaterial({
    color: 0x0099ad,
    roughness: 0.85,
    metalness: 0.05,
    side: THREE.DoubleSide,
  });
  _boidInst = new THREE.InstancedMesh(geom, mat, CONFIG.count);
  _boidInst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(_boidInst);

  const halfW = 200 * 0.5 - CONFIG.boundMargin;
  const halfD = 200 * 0.5 - CONFIG.boundMargin;

  for (let i = 0; i < CONFIG.count; i++) {
    const x = THREE.MathUtils.randFloat(-halfW, halfW);
    const z = THREE.MathUtils.randFloat(-halfD, halfD);
    const y0 =
      (_terrain.heightAtXZ(x, z) - _terrain.uniforms.seaLevel.value) *
        _terrain.uniforms.heightScale.value +
      CONFIG.hover;
    _pos[i] = new THREE.Vector3(x, y0, z);
    const dir = new THREE.Vector3().setFromSphericalCoords(
      1,
      Math.PI * 0.5,
      Math.random() * Math.PI * 2
    );
    _vel[i] = dir.multiplyScalar(THREE.MathUtils.randFloat(3.0, 7.0));
    _acc[i] = new THREE.Vector3();
  }

  for (let i = 0; i < CONFIG.count; i++) {
    const p = _pos[i];
    const v = _vel[i];
    const yaw = Math.atan2(v.x, v.z);
    _dummyObj.position.copy(p);
    _dummyObj.rotation.set(0, yaw, 0);
    _dummyObj.scale.set(CONFIG.scale, CONFIG.scale, CONFIG.scale);
    _dummyObj.updateMatrix();
    _boidInst.setMatrixAt(i, _dummyObj.matrix);
  }
  _boidInst.instanceMatrix.needsUpdate = true;

  console.log(`[Boids] ${CONFIG.count}개 초기화 완료`);
  return true;
}

export function updateBoids(dt) {
  if (!_boidInst || !_terrain) return;
  updateBoidsLogic(dt);
}

export function getBoidsConfig() {
  return CONFIG;
}

