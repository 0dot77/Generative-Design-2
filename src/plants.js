// plants.js - L-System 식물 관리
import * as THREE from "three";
import {
  createLSystem,
  setupLSystemControls,
  setupEnvironmentControls,
  getEnvironmentState,
} from "./lsystem.js";

let _lsystems = [];
let _terrain = null;
let _scene = null;

/* ========================= 
 * 복도 위치 찾기
 * ========================= */
function findAislePositions(terrainObj, count = 15) {
  const positions = [];
  const terrainSize = { width: 200, depth: 200 };
  const halfW = terrainSize.width * 0.5;
  const halfD = terrainSize.depth * 0.5;
  const margin = 15;

  const attempts = count * 10;
  for (let i = 0; i < attempts && positions.length < count; i++) {
    const x = THREE.MathUtils.randFloat(-halfW + margin, halfW - margin);
    const z = THREE.MathUtils.randFloat(-halfD + margin, halfD - margin);

    const h = terrainObj.heightAtXZ(x, z);
    const seaLevel = terrainObj.uniforms.seaLevel.value;

    const isAisle = h < seaLevel + 0.08;

    if (isAisle) {
      const minDist = 12.0;
      let tooClose = false;
      for (const pos of positions) {
        const dx = pos.x - x;
        const dz = pos.z - z;
        if (Math.sqrt(dx * dx + dz * dz) < minDist) {
          tooClose = true;
          break;
        }
      }

      if (!tooClose) {
        const worldY =
          (h - seaLevel) * terrainObj.uniforms.heightScale.value;
        positions.push({ x, y: worldY + 0.5, z });
      }
    }
  }

  console.log(`[Plants] 복도/틈 위치 ${positions.length}개 발견`);
  return positions;
}

/* ========================= 
 * 공개 API
 * ========================= */
export function initPlants(scene, terrain) {
  if (!terrain) {
    console.warn("[Plants] 지형이 아직 준비되지 않았습니다.");
    return;
  }

  _scene = scene;
  _terrain = terrain;

  console.log("[Plants] 식물 생성 시작...");

  const plantCount = 15;
  const positions = findAislePositions(terrain, plantCount);

  for (let i = 0; i < positions.length; i++) {
    const pos = positions[i];

    // 비정형 유기체 스타일 파라미터
    const genMax = THREE.MathUtils.randInt(4, 6); // 세대 증가
    const angleDeg = THREE.MathUtils.randFloat(15, 35); // 각도 범위 넓게
    const step = THREE.MathUtils.randFloat(1.2, 2.5); // 짧은 세그먼트
    const baseRadius = THREE.MathUtils.randFloat(0.12, 0.22); // 가는 줄기
    const heatLevel = THREE.MathUtils.randFloat(0.25, 0.55);
    const electricNoise = THREE.MathUtils.randFloat(0.15, 0.4);
    const ioVibration = THREE.MathUtils.randFloat(0.08, 0.22);
    const animateSpeed = THREE.MathUtils.randFloat(15, 30);
    const startDelay = i * 0.5;

    const lsys = createLSystem(scene, {
      genMax,
      angleDeg,
      decay: 0.90, // 더 천천히 감쇠
      step,
      baseRadius,
      animateSpeed,
      scaleY: THREE.MathUtils.randFloat(1.1, 1.6), // 더 높게
      scaleX: 1.0,
      radiusDecay: THREE.MathUtils.randFloat(0.82, 0.90), // 천천히 가늘어짐
      branchProb: THREE.MathUtils.randFloat(0.85, 0.98), // 분기 확률 높게
      bendFactor: THREE.MathUtils.randFloat(0.20, 0.35), // 더 많이 휘어짐
      twistY: THREE.MathUtils.randFloat(0.08, 0.15), // 더 많이 비틀림
      asymmetry: THREE.MathUtils.randFloat(0.40, 0.60), // 비대칭 강화
      heatLevel,
      electricNoise,
      ioVibration,
      idleCycles: THREE.MathUtils.randInt(0, 5),
      mergeRadius: THREE.MathUtils.randFloat(2.5, 4.0),
      mergeAngleTol: 0.8,
      posX: pos.x,
      posY: pos.y,
      posZ: pos.z,
      startDelay,
    });

    if (startDelay > 0) {
      lsys.animator.paused = true;
      setTimeout(() => {
        if (lsys.animator) lsys.animator.paused = false;
      }, startDelay * 1000);
    }

    _lsystems.push(lsys);
  }

  console.log(`[Plants] ✅ 식물 ${_lsystems.length}개 생성 완료!`);
  console.log(`[키맵] Space(전체 재생/정지), [/](세대 ±), J/K(각도 ±), N/M(감쇠 ±)`);
  console.log(`[환경] H/G(열 ±), E/Q(전류 ±), I/U(정적 ±)`);

  // 키보드 컨트롤 설정
  if (_lsystems.length > 0) {
    setupLSystemControls(_lsystems, () => {
      for (const lsys of _lsystems) {
        // plantMesh를 제거하면 자식인 chargeMesh도 자동 제거됨
        _scene.remove(lsys.plantMesh);
      }
      _lsystems = [];
      initPlants(_scene, _terrain);
    });
  }

  setupEnvironmentControls();
}

export function updatePlants(time, dt) {
  const env = getEnvironmentState();

  for (const lsys of _lsystems) {
    if (lsys?.animator) lsys.animator.update(dt);

    // 전하 구슬 미세 애니메이션 + 환경 반응
    if (lsys?.chargeMesh) {
      const basePos = lsys.plantMesh.position;
      const phase = basePos.x * 0.5 + basePos.z * 0.3;

      // 미세한 크기 변화
      const pulse = 1.0 + Math.sin(time * 1.2 + phase) * 0.03;
      lsys.chargeMesh.scale.set(pulse, pulse, pulse);

      // 발광 강도 - 환경에 따라 변화
      const baseIntensity = 0.8 + env.electricNoise * 0.8;
      const pulseIntensity = Math.sin(time * 0.8 + phase * 0.5) * 0.1;
      lsys.chargeMesh.material.emissiveIntensity =
        baseIntensity + pulseIntensity;

      // 색상 - 열/전류에 따라 변화
      const mat = lsys.chargeMesh.material;
      const r = env.heatLevel * 0.8;
      const g = 0.3 + env.electricNoise * 0.4;
      const b = 1.0;
      mat.color.setRGB(r, g, b);
      mat.emissive.setRGB(r * 0.8, g * 0.6, b * 0.9);
    }
  }
}

export function getPlants() {
  return _lsystems;
}

