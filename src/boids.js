// boids.js - Boids 시뮬레이션 시스템
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as BufferGeometryUtils from "three/addons/utils/BufferGeometryUtils.js";

// 보이드들이 움직이는 월드 반경 (x,z에서 -R ~ +R)
// terrainSize.width/depth가 200으로 설정되어 있으므로 여기서는 100으로 맞춘다.
const BOUND_RADIUS = 100;

// ───────────────────────────────
// Slime Mold Sensing / Trail
// ───────────────────────────────

// HUD(lil-gui)에서 조정할 수 있는 슬라임/트레일 파라미터 모음
// → main.js에서 import { slimeParams } 해서 슬라이더에 바인딩한다.
export const slimeParams = {
  TRAIL_DEPOSIT_AMOUNT: 2.0,
  TRAIL_DECAY_RATE: 0.97,        // 1에 가깝게 → 천천히 사라짐 (길 유지)
  W_TRAIL_FOLLOW: 3.0,           // trail을 더 강하게 따라가도록
  SENSOR_DISTANCE: 12,           // 아이데이션에 맞게 조정
  SENSOR_ANGLE: Math.PI / 4,     // 45도, 미로면 더 좁게, 탐험형이면 더 넓게 (라디안)
};

const TRAIL_GRID_SIZE = 128;             // trail 해상도 (128x128)
const TRAIL_CELL_SIZE = (BOUND_RADIUS * 2) / TRAIL_GRID_SIZE;

const W_NUTRIENT = 1.0;                  // 영양원 attraction 가중치

let trailGrid = new Float32Array(TRAIL_GRID_SIZE * TRAIL_GRID_SIZE);

// RD 패턴 텍스처 경로 (GA 설계 기반)
const RD_TEXTURE_PATHS = [
  "./assets/textures/rd_pattern.png", // 0
  "./assets/textures/rd_pattern2.png", // 1
  "./assets/textures/rd_pattern3.png", // 2
  "./assets/textures/rd_pattern4.png", // 3
  "./assets/textures/rd_pattern5.png", // 4
];

// 텍스처 로드 (InstancedMesh 제약으로 현재는 "공통 RD 패턴 + 색/동작" 차별화에 사용)
const _rdTextures = [];
const _texLoader = new THREE.TextureLoader();
for (const path of RD_TEXTURE_PATHS) {
  const tex = _texLoader.load(
    path,
    () => {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.needsUpdate = true;
    },
    undefined,
    () => {
      console.warn(`[Boids] RD texture load failed: ${path}`);
    }
  );
  _rdTextures.push(tex);
}

// Boids 파라미터
const CONFIG = {
  count: 40, // GA populationSize와 맞춤
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
const _boidMeshes = []; // per-boid Mesh (InstancedMesh 대신)
const _pos = [];
const _vel = [];
const _acc = [];
let _terrain = null;

// GA 연동: Genome / 생애 상태
const _genomes = []; // index → Genome
const _baseColors = []; // index → THREE.Color
const _states = []; // "alive" | "dying" | "dead" | "newborn"
const _deathTimers = [];
const _newbornTimers = [];
let _deathDuration = 2.0;
let _newbornDuration = 1.0;
let _simTime = 0;

const STATE_ALIVE = "alive";
const STATE_DYING = "dying";
const STATE_DEAD = "dead";
const STATE_NEWBORN = "newborn";

// 패턴별 색상 악센트 (시각적으로 명확히 구분되도록)
// - 서버실 톤을 유지하면서도 hue/sat를 달리 줘서 한눈에 패턴이 보이게 한다.
const PATTERN_ACCENT_COLORS = [
  new THREE.Color(0x00d9ff), // A: 시안 계열 (soft_spots)
  new THREE.Color(0x5eff7e), // B: 연두/그린 (micro_spots)
  new THREE.Color(0x3b7bff), // C: 코발트 블루 (blobs)
  new THREE.Color(0xff7bff), // D: 마젠타 계열 (fine_stripes)
  new THREE.Color(0xffc54b), // E: 앰버/골드 (hybrid)
];

// 세대별 팔레트 (Genome.genId 기반으로 세대 느낌을 살짝 달리 줄 때 사용)
const GENERATION_TINTS = [
  new THREE.Color(0x4cc9f0), // Gen 0 계열: 밝은 시안
  new THREE.Color(0xf72585), // Gen 1 계열: 마젠타
  new THREE.Color(0xffca3a), // Gen 2 계열: 옐로우/오렌지
  new THREE.Color(0x8ac926), // Gen 3 계열: 라임 그린
  new THREE.Color(0xff6b6b), // Gen 4 계열: 코럴 레드
];

/* ========================= 
 * 유틸리티 (색 변환)
 * ========================= */
function hsvToRgb(h, s, v) {
  // h: 0~360, s: 0~1, v: 0~1
  h = ((h % 360) + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0,
    g = 0,
    b = 0;
  if (h < 60) {
    r = c;
    g = x;
  } else if (h < 120) {
    r = x;
    g = c;
  } else if (h < 180) {
    g = c;
    b = x;
  } else if (h < 240) {
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  return { r: r + m, g: g + m, b: b + m };
}

function createFallbackGenome() {
  return {
    hue: 190,
    value: 0.6,
    patternId: 0,
    bodyScale: 1.0,
    baseSpeed: 1.0,
    showOff: 0.3,
  };
}

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

// ───────────────────────────────
// Nutrient Field / Attraction
// ───────────────────────────────

// 최대 10개의 영양원
const NUTRIENT_COUNT = 10;

// 각 영양원: 산 지형 위 특정 위치, 열/시간에 따라 strength가 다름
// - pos: THREE.Vector3 (월드 좌표, 렉/호수 근처 등)
// - strength: 0~1 정도 (열이 막 올랐을 때 1에 가깝게, 시간이 지나면 감소 등)
// - active: true 일 때만 force에 기여 (열이 꺼졌거나 먹혔으면 false)
const _nutrients = new Array(NUTRIENT_COUNT).fill(null).map(() => ({
  pos: new THREE.Vector3(),
  strength: 0.0,
  active: false,
}));

/**
 * 환경/열 시스템 쪽에서 프레임마다 영양원 상태를 갱신할 때 사용할 수 있는 헬퍼.
 * (원하지 않으면 사용 안 해도 됨. 필요한 곳에서 _nutrients 배열을 직접 만져도 됨.)
 */
export function setNutrientState(index, pos, strength, active = true) {
  if (index < 0 || index >= NUTRIENT_COUNT) return;
  const n = _nutrients[index];
  n.pos.copy(pos);
  n.strength = strength;
  n.active = active;
}

/**
 * 개체가 영양을 먹었거나, 열이 완전히 식어서 영양원이 사라졌을 때 호출.
 */
export function clearNutrient(index) {
  if (index < 0 || index >= NUTRIENT_COUNT) return;
  const n = _nutrients[index];
  n.active = false;
  n.strength = 0.0;
}

/**
 * 영양원 force 계산
 * - pos: 에이전트 위치 (THREE.Vector3)
 * - return: 영양원 쪽 방향 (단위 벡터)
 *   - 길이 0이면 "이번 프레임엔 영양원 영향 없음"을 의미
 */
export function getNutrientForce(pos) {
  // 가비지 줄이기 위해 재사용하는 임시 벡터
  const dirAccum = new THREE.Vector3(0, 0, 0);
  let totalWeight = 0.0;

  for (let i = 0; i < NUTRIENT_COUNT; i++) {
    const n = _nutrients[i];
    if (!n.active || n.strength <= 0.0) continue;

    // 현재 위치에서 영양원까지의 방향
    const dx = n.pos.x - pos.x;
    const dy = n.pos.y - pos.y;
    const dz = n.pos.z - pos.z;

    const distSq = dx * dx + dy * dy + dz * dz;
    if (distSq < 1e-4) {
      // 거의 같은 위치면 방향 정보가 의미 없으므로 스킵
      continue;
    }

    const dist = Math.sqrt(distSq);
    const invDist = 1.0 / dist;

    // 단위 방향 벡터
    const ux = dx * invDist;
    const uy = dy * invDist;
    const uz = dz * invDist;

    // 거리와 강도를 함께 반영한 가중치
    // - 가까울수록(invDist) + 강할수록(strength) 더 크게 끌어당김
    const weight = n.strength * invDist;

    dirAccum.x += ux * weight;
    dirAccum.y += uy * weight;
    dirAccum.z += uz * weight;
    totalWeight += weight;
  }

  // 활성 영양원이 없거나, 실질적으로 힘이 없으면 영향 없음
  if (totalWeight <= 1e-6) {
    return new THREE.Vector3(0, 0, 0);
  }

  // 가중 평균 방향 벡터
  dirAccum.multiplyScalar(1.0 / totalWeight);

  // 혹시라도 수치적으로 거의 0이면 영향 없음 처리
  if (dirAccum.lengthSq() < 1e-6) {
    return new THREE.Vector3(0, 0, 0);
  }

  // 반드시 normalize된 단위벡터 반환
  return dirAccum.normalize();
}

function updateBoidsLogic(dt, t) {
  _simTime = t;
  const N = CONFIG.count;
  for (let i = 0; i < N; i++) _acc[i].set(0, 0, 0);

  for (let i = 0; i < N; i++) {
    if (_states[i] === STATE_DEAD) continue;
    const pi = _pos[i];
    const vi = _vel[i];
    let sumV = new THREE.Vector3();
    let sumP = new THREE.Vector3();
    let sep = new THREE.Vector3();
    let cnt = 0;

    for (let j = 0; j < N; j++)
      if (j !== i && _states[j] !== STATE_DEAD) {
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
    const genome = _genomes[i];
    const speedFactor = genome && typeof genome.baseSpeed === "number" ? genome.baseSpeed : 1.0;

    if (cnt > 0) {
      const align = sumV.multiplyScalar(1 / cnt).setY(0);
      align
        .normalize()
        .multiplyScalar(CONFIG.maxSpeed * speedFactor)
        .sub(vi)
        .clampLength(0, CONFIG.maxForce);
      acc.addScaledVector(align, CONFIG.alignWeight);

      const center = sumP.multiplyScalar(1 / cnt);
      const cohesion = center.sub(pi).setY(0);
      cohesion
        .normalize()
        .multiplyScalar(CONFIG.maxSpeed * speedFactor)
        .sub(vi)
        .clampLength(0, CONFIG.maxForce);
      acc.addScaledVector(cohesion, CONFIG.cohesionWeight);
    }

    if (sep.lengthSq() > 0) {
      sep
        .normalize()
        .multiplyScalar(CONFIG.maxSpeed * speedFactor)
        .sub(vi)
        .clampLength(0, CONFIG.maxForce);
      acc.addScaledVector(sep, CONFIG.separationWeight);
    }

    // ① 영양원 force: 영양원 방향 단위벡터를 acc에 더한다.
    const nutrientDir = getNutrientForce(pi);
    if (nutrientDir.lengthSq() > 0) {
      acc.addScaledVector(nutrientDir, W_NUTRIENT);
    }

    // ② trail sensing force: 슬라임 몰드식 trail 따라가기
    applyTrailSensingForce(i, acc);

    acc.x += (Math.random() - 0.5) * 0.2;
    acc.z += (Math.random() - 0.5) * 0.2;
  }

  const terrainSize = { width: 200, depth: 200 };
  for (let i = 0; i < N; i++) {
    const state = _states[i];
    const genome = _genomes[i];
    const speedFactor = genome && typeof genome.baseSpeed === "number" ? genome.baseSpeed : 1.0;
    const mesh = _boidMeshes[i];
    if (!mesh) continue;

    if (state === STATE_DEAD) {
      // 죽은 개체는 보이지 않도록 숨김
      mesh.visible = false;
      continue;
    }
    mesh.visible = true;

    const p = _pos[i];
    const v = _vel[i];
    const a = _acc[i];
    v.addScaledVector(a, dt * speedFactor);
    confineToTerrain({ pos: p, vel: v }, terrainSize, CONFIG.boundMargin, CONFIG.boundSteer);
    followSurface(
      { pos: p, vel: v },
      CONFIG.surfHeightLerp,
      CONFIG.surfHover,
      CONFIG.surfSlide
    );
    limitVec3(v, CONFIG.maxSpeed * speedFactor);
    p.addScaledVector(v, dt);
    // ▼ 위치가 최종적으로 업데이트된 직후, 해당 지점에 trail을 남긴다.
    //    (이 줄 바로 아래에 depositTrail(p.x, p.z)를 호출하도록 설계)
    depositTrail(p.x, p.z);

    // 기본 회전 (진행 방향)
    const yaw = Math.atan2(v.x, v.z);
    let pitch = 0;
    let roll = 0;

    // showOff에 따른 요란한 진동
    const show =
      genome && typeof genome.showOff === "number" ? genome.showOff : 0.3;
    if (show > 0) {
      const phase = i * 0.37;
      const wobble = Math.sin(_simTime * 3.0 + phase) * show;
      pitch = wobble * 0.6; // 훨씬 큰 굴절
      roll = Math.cos(_simTime * 2.2 + phase * 1.7) * show * 0.6;
    }

    // 기본 스케일 + genome bodyScale + 생애 상태 애니메이션
    const baseScale = genome && typeof genome.bodyScale === "number"
      ? genome.bodyScale * CONFIG.scale
      : CONFIG.scale;

    let scaleMul = 1.0;
    if (state === STATE_DYING) {
      _deathTimers[i] += dt;
      const tNorm = Math.min(1.0, _deathTimers[i] / _deathDuration);
      scaleMul = THREE.MathUtils.lerp(1.0, 0.2, tNorm);
      p.y -= 0.4 * dt; // 천천히 가라앉는 느낌
      if (_deathTimers[i] >= _deathDuration) {
        _states[i] = STATE_DEAD;
        scaleMul = 0.0001;
      }
    } else if (state === STATE_NEWBORN) {
      _newbornTimers[i] += dt;
      const tNorm = Math.min(1.0, _newbornTimers[i] / _newbornDuration);
      scaleMul = THREE.MathUtils.lerp(0.2, 1.0, tNorm);
      if (_newbornTimers[i] >= _newbornDuration) {
        _states[i] = STATE_ALIVE;
      }
    }

    // 현재 위치의 trail 강도를 0~1로 정규화해서 읽는다.
    const trailStrength = getTrailStrengthAt(p);

    // trail이 강한 곳일수록 약간 더 크게 보이도록 스케일 배수 적용
    // (0.9 ~ 1.5 사이에서 보간, 지나가는 자취는 "색" 위주로 표현)
    const visScaleMul = THREE.MathUtils.lerp(0.9, 1.5, trailStrength);
    const finalScale = baseScale * scaleMul * visScaleMul;

    // 위치/회전/스케일을 직접 Mesh에 적용
    mesh.position.copy(p);
    mesh.rotation.set(pitch, yaw, roll);
    mesh.scale.set(finalScale, finalScale, finalScale);

    // trail이 강할수록 "색깔"과 발광으로 지나간 자취를 강조
    const mat = mesh.material;
    const baseCol = _baseColors[i];
    if (mat && mat.isMeshStandardMaterial && baseCol) {
      // 기본 Genome 색을 유지하되, trail이 강할수록 "뜨거운" 색으로 틴트
      const colorLerp = trailStrength; // 0~1 사이 그대로 사용
      _tmpTrailColor.copy(baseCol).lerp(_trailHotColor, colorLerp);
      mat.color.copy(_tmpTrailColor);

      // emissive는 baseCol 대신 hot color 기준으로 강하게 발광
      const emissiveStrength = THREE.MathUtils.lerp(0.0, 3.0, trailStrength);
      mat.emissive.copy(_trailHotColor).multiplyScalar(emissiveStrength);
    }

    // ───────────────────────────────
    // 에이전트 기반 사운드 트리거
    // - 속도 / trail / 영양원 영향도를 하나의 value(0~10)로 매핑
    // - 매 프레임 전부 울리면 과하므로, 확률적으로 일부만 재생
    // ───────────────────────────────
    if (typeof window !== "undefined" && window.playAgentSoundFromValue) {
      // 너무 많은 사운드 폭주를 막기 위한 간단한 샘플링 (약 2% 확률)
      if (Math.random() < 0.02) {
        // 1) 속도 기반 value (0~10)
        const speed = v.length();
        const maxSpeedForThis = CONFIG.maxSpeed * speedFactor;
        const speedNorm =
          maxSpeedForThis > 1e-5 ? THREE.MathUtils.clamp(speed / maxSpeedForThis, 0, 1) : 0;
        let value = speedNorm * 10.0;

        // 2) trailStrength로 value 증폭 (길 위에 있을수록 더 "핫"하게)
        const trailBoost = 0.7 + trailStrength * 0.6; // 0.7~1.3 배
        value *= trailBoost;

        // 3) 영양원 영향도 (0~1 가정)를 보너스로 더해줌
        const nutrientDir = getNutrientForce(p);
        const nutrientInfluence = THREE.MathUtils.clamp(nutrientDir.length(), 0, 1);
        value += nutrientInfluence * 3.0;

        // 4) 최종 클램프 후 사운드 트리거
        value = THREE.MathUtils.clamp(value, 0, 10);
        window.playAgentSoundFromValue(value);
      }
    }
  }

  // ▼ 모든 에이전트가 trail을 남긴 뒤, 프레임마다 전체 trail을 서서히 감쇠시킨다.
  //    (trailGrid[i] *= TRAIL_DECAY_RATE)
  decayTrail();
}

/* ========================= 
 * Genome → Boid 매핑
 * ========================= */

function applyGenomeToBoid(index, genome) {
  const g = genome || createFallbackGenome();
  _genomes[index] = g;

  // ★ 디버그/시각화를 위해, 세대(genId)에 따라 "완전히 다른 단색"을 준다.
  //   → 텍스쳐/조명 영향 없이 세대 차이가 즉시 눈에 들어오도록.
  const genId = typeof g.genId === "number" ? g.genId : 0;
  let col;
  switch (genId % 6) {
    case 0:
      col = new THREE.Color(0xffffff); // 0세대: 흰색
      break;
    case 1:
      col = new THREE.Color(0xff0000); // 1세대: 빨강
      break;
    case 2:
      col = new THREE.Color(0x00ff00); // 2세대: 초록
      break;
    case 3:
      col = new THREE.Color(0x0000ff); // 3세대: 파랑
      break;
    case 4:
      col = new THREE.Color(0xffff00); // 4세대: 노랑
      break;
    case 5:
    default:
      col = new THREE.Color(0xff00ff); // 5세대: 마젠타
      break;
  }

  _baseColors[index] = col;

  const mesh = _boidMeshes[index];
  if (mesh && mesh.material && mesh.material.isMeshStandardMaterial) {
    mesh.material.color.copy(col);
    mesh.material.emissive.copy(col).multiplyScalar(0.2);
    mesh.material.needsUpdate = true;
  }
}

/* ========================= 
 * 공개 API
 * ========================= */
export async function initBoids(scene, terrain, initialGenomes = null) {
  if (!terrain) return false;
  _terrain = terrain;

  const geom = await loadBoidGeometry();
  const baseTex = _rdTextures[0] || null;

  for (let i = 0; i < CONFIG.count; i++) {
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.6,
      metalness: 0.2,
      side: THREE.DoubleSide,
    });
    if (baseTex) {
      mat.map = baseTex;
      mat.map.wrapS = mat.map.wrapT = THREE.RepeatWrapping;
      mat.map.repeat.set(2, 2);
      mat.map.needsUpdate = true;
    }
    const mesh = new THREE.Mesh(geom, mat);
    scene.add(mesh);
    _boidMeshes[i] = mesh;
  }

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

    // Genome & 상태 초기화
    const g = initialGenomes && initialGenomes[i] ? initialGenomes[i] : createFallbackGenome();
    applyGenomeToBoid(i, g);
    _states[i] = STATE_ALIVE;
    _deathTimers[i] = 0;
    _newbornTimers[i] = 0;
  }

  console.log(`[Boids] ${CONFIG.count}개 초기화 완료`);
  return true;
}

export function updateBoids(dt) {
  if (_boidMeshes.length === 0 || !_terrain) return;
  const t = _simTime + dt;
  updateBoidsLogic(dt, t);
}

// ───────────────────────────────
// Sensing force / Trail 시각화용 임시 벡터/색상
// ───────────────────────────────
const _yAxis = new THREE.Vector3(0, 1, 0);
const _tmpDir = new THREE.Vector3();
const _tmpLeftDir = new THREE.Vector3();
const _tmpRightDir = new THREE.Vector3();
const _tmpTrailColor = new THREE.Color();
const _trailHotColor = new THREE.Color(0xffaa00); // trail이 강한 곳을 강조할 색

function applyTrailSensingForce(agentIndex, accOut) {
  const pos = _pos[agentIndex];
  const vel = _vel[agentIndex];
  if (!pos || !vel) return;

  // 속도가 거의 없으면 방향 판단 불가능 → skip
  if (vel.lengthSq() < 1e-6) return;

  // 1) 현재 진행 방향 단위벡터
  _tmpDir.copy(vel).normalize();

  // 2) 좌/우 센서 방향 (현재 방향 기준 회전)
  _tmpLeftDir.copy(_tmpDir).applyAxisAngle(_yAxis, +slimeParams.SENSOR_ANGLE);
  _tmpRightDir.copy(_tmpDir).applyAxisAngle(_yAxis, -slimeParams.SENSOR_ANGLE);

  // 3) 센서 위치 (샘플링 지점)
  const fx = pos.x + _tmpDir.x * slimeParams.SENSOR_DISTANCE;
  const fz = pos.z + _tmpDir.z * slimeParams.SENSOR_DISTANCE;

  const lx = pos.x + _tmpLeftDir.x * slimeParams.SENSOR_DISTANCE;
  const lz = pos.z + _tmpLeftDir.z * slimeParams.SENSOR_DISTANCE;

  const rx = pos.x + _tmpRightDir.x * slimeParams.SENSOR_DISTANCE;
  const rz = pos.z + _tmpRightDir.z * slimeParams.SENSOR_DISTANCE;

  // 4) trail 값 샘플링
  const valF = sampleTrail(fx, fz);
  const valL = sampleTrail(lx, lz);
  const valR = sampleTrail(rx, rz);

  // 5) 가장 강한 값의 방향 선택
  let bestDir = _tmpDir;
  let bestVal = valF;

  if (valL > bestVal) {
    bestVal = valL;
    bestDir = _tmpLeftDir;
  }
  if (valR > bestVal) {
    bestVal = valR;
    bestDir = _tmpRightDir;
  }

  // 거의 신호가 없으면 steer 필요 없음
  if (bestVal <= 0.001) return;

  // 6) 그 방향으로 힘을 추가
  accOut.addScaledVector(bestDir, slimeParams.W_TRAIL_FOLLOW * bestVal);
}


export function getBoidsConfig() {
  return CONFIG;
}

/**
 * GA 선택 결과를 기반으로 생존자/도태된 개체의 상태를 표시한다.
 * - survivors: 살아남은 인덱스
 * - doomed: 죽어갈 인덱스
 */
export function markSelection(survivors, doomed, deathDuration = 2.0) {
  _deathDuration = deathDuration;
  const N = CONFIG.count;

  for (let i = 0; i < N; i++) {
    if (doomed.includes(i)) {
      _states[i] = STATE_DYING;
      _deathTimers[i] = 0;
    } else if (survivors.includes(i)) {
      _states[i] = STATE_ALIVE;
      _deathTimers[i] = 0;
    }
  }
}

/**
 * 새로운 세대의 Genome을 특정 인덱스들에만 적용한다.
 * - population[i]는 i번째 boid에 대응하는 genome
 * - indices가 없으면 전체에 적용
 */
export function applyPopulationGenomes(population, indices = null) {
  const N = CONFIG.count;
  const targetIndices = indices ?? Array.from({ length: N }, (_, i) => i);
  for (const i of targetIndices) {
    if (!population[i]) continue;
    applyGenomeToBoid(i, population[i]);
  }
}

/**
 * 새로 태어나는 boid에 대해 newborn 애니메이션을 설정한다.
 */
export function markNewborn(indices, newbornDuration = 1.0) {
  _newbornDuration = newbornDuration;
  for (const i of indices) {
    _states[i] = STATE_NEWBORN;
    _newbornTimers[i] = 0;
  }
}

/* ========================= 
 * Slime Mold Sensing / Trail
 * 환경을 기록하고 읽어내기 위한 시스템
 * ========================= */

// 보이드 주변의 trail 시각 강도 상한값 (경험적으로 조정)
// - 작은 trail도 강하게 보이도록 과감하게 낮춘 값
const MAX_TRAIL_VIS_VALUE = 1.0; // 경험적으로 조정

// 보이드 주변의 trail 강도를 0~1로 정규화해서 반환하는 함수
function getTrailStrengthAt(pos) {
  if (!pos) return 0.0;
  const raw = sampleTrail(pos.x, pos.z);
  let norm = raw / MAX_TRAIL_VIS_VALUE;
  norm = THREE.MathUtils.clamp(norm, 0.0, 1.0);
  // 낮은 값도 더 부각되도록 감마(루트) 적용
  return Math.sqrt(norm);
}

function worldToTrailIndex(x, z) {
  // 월드(-BOUND_RADIUS ~ +BOUND_RADIUS)를 0~1로 매핑
  const u = (x + BOUND_RADIUS) / (BOUND_RADIUS * 2);
  const v = (z + BOUND_RADIUS) / (BOUND_RADIUS * 2);

  const ix = Math.floor(
    THREE.MathUtils.clamp(u, 0, 0.999) * TRAIL_GRID_SIZE
  );
  const iz = Math.floor(
    THREE.MathUtils.clamp(v, 0, 0.999) * TRAIL_GRID_SIZE
  );

  return ix + iz * TRAIL_GRID_SIZE;
}

function sampleTrail(x, z) {
  const idx = worldToTrailIndex(x, z);
  return trailGrid[idx];
}

function depositTrail(x, z, amount) {
  const idx = worldToTrailIndex(x, z);
  const a = amount != null ? amount : slimeParams.TRAIL_DEPOSIT_AMOUNT;
  trailGrid[idx] += a;
}

function decayTrail() {
  for (let i = 0; i < trailGrid.length; i++) {
    trailGrid[i] *= slimeParams.TRAIL_DECAY_RATE;
  }
}
