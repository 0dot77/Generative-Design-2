// lsystem.js - 서버실 전선 식물(열/전류 자양분, 그물 구조)
import * as THREE from "three";
import * as BufferGeometryUtils from "three/addons/utils/BufferGeometryUtils.js";

/* ========================= 
 * 파라미터: 파일 상단 변수 분리
 * ========================= */
// 기본 L-System 파라미터
let angleDeg = 28.0;        // 분기 각도(도)
let decay = 0.86;          // 세대마다 두께/투명도 감쇠
let genMax = 5;            // 최대 세대 수
let step = 1.2;            // F 전진 거리
let baseRadius = 0.15;     // 초기 줄기 반경
let animateSpeed = 18.0;   // 세그먼트/초

// 형태 제어 확장 파라미터
let scaleY = 1.0;          // Y축 스케일
let scaleX = 1.0;          // XZ 평면 스케일
let radiusDecay = 0.80;    // 반경 감쇠율
let branchProb = 0.90;     // 분기 확률(0~1)
let bendFactor = 0.15;     // 진동 bias 굴곡 강도
let twistY = 0.08;         // Y축 회전 누적
let asymmetry = 0.35;      // 좌우 비대칭 정도

// 환경 자극 파라미터
let heatLevel = 0.0;       // 열 수준(0~1)
let electricNoise = 0.0;   // 전류 잡음(0~1)
let ioVibration = 0.0;     // I/O 진동(0~1)
let idleCycles = 0;        // 정적 사이클 카운터

// 그물 구조 파라미터
let mergeRadius = 2.8;     // merge 시도 반경
let mergeAngleTol = 0.75;  // merge 각도 허용(라디안)
let mergeCooldown = 2;     // merge 후 대기 세대
let mergeMaxDegree = 4;    // 노드당 최대 연결 수

/* ========================= 
 * 상태 구조체
 * ========================= */
class TurtleState {
  constructor(pos, dir, up, radius, generation, mergeCD, nodeID) {
    this.pos = pos.clone();
    this.dir = dir.clone().normalize();
    this.up = up.clone().normalize();
    this.radius = radius;
    this.generation = generation;
    this.mergeCD = mergeCD;  // merge 쿨다운
    this.nodeID = nodeID;    // 노드 추적용 ID
  }
  clone() {
    return new TurtleState(
      this.pos, this.dir, this.up,
      this.radius, this.generation, this.mergeCD, this.nodeID
    );
  }
}

/* ========================= 
 * 환경 자극 함수
 * ========================= */
function getGrowthBoost() {
  // 열 + 전류 → 성장 촉진
  return 1.0 + (heatLevel * 0.3 + electricNoise * 0.2);
}

function getDirectionBias(pos) {
  // I/O 진동장에 따라 방향 변화
  const phase = pos.x * 0.1 + pos.z * 0.1;
  const bias = Math.sin(phase + ioVibration * Math.PI * 2) * bendFactor;
  return bias;
}

function shouldCoil() {
  // 과열 + 높은 잡음 → 휴면 진입
  return (heatLevel > 0.75 && electricNoise > 0.6);
}

function shouldUncoil() {
  // 온도 하락 → 휴면 해제
  return (heatLevel < 0.4);
}

function shouldSpawnCharge(state) {
  // tip 끝에 전하 구슬 생성 (확률적)
  // 조건: 세대 3 이상 + 30% 확률 (또는 높은 idleCycles)
  return (state.generation >= 3 && (Math.random() < 0.3 || idleCycles > 8));
}

/* ========================= 
 * L-System 규칙 생성기
 * ========================= */
function applyRules(axiom, gen) {
  let current = axiom;
  for (let g = 0; g < gen; g++) {
    let next = "";
    for (let i = 0; i < current.length; i++) {
      const c = current[i];
      switch (c) {
        case "F": {
          // R1: F → F[+a F][-a F] (2-branch)
          // R1b: 확률적으로 3-branch
          const boost = getGrowthBoost();
          if (Math.random() < branchProb * boost) {
            if (Math.random() < 0.3) {
              // 3-branch
              next += "F[+F][+F][-F]";
            } else {
              // 2-branch
              next += "F[+F][-F]";
            }
          } else {
            next += "F"; // 분기 없이 직진
          }
          break;
        }
        default:
          next += c;
          break;
      }
    }
    current = next;
  }
  return current;
}

/* ========================= 
 * 그물 구조: Merge 로직
 * ========================= */
class MergeGraph {
  constructor() {
    this.nodes = [];     // {id, pos, degree, tipActive}
    this.edges = [];     // {from, to}
    this.nextID = 0;
  }

  addNode(pos, isTip = true) {
    const id = this.nextID++;
    this.nodes.push({ id, pos: pos.clone(), degree: 0, tipActive: isTip });
    return id;
  }

  findNearNode(pos, maxDist) {
    let best = null;
    let bestDist = maxDist;
    for (const n of this.nodes) {
      if (n.degree >= mergeMaxDegree) continue;
      const d = pos.distanceTo(n.pos);
      if (d < bestDist) {
        bestDist = d;
        best = n;
      }
    }
    return best;
  }

  findNearTip(pos, maxDist) {
    let best = null;
    let bestDist = maxDist;
    for (const n of this.nodes) {
      if (!n.tipActive || n.degree >= mergeMaxDegree) continue;
      const d = pos.distanceTo(n.pos);
      if (d < bestDist && d > 0.1) {
        bestDist = d;
        best = n;
      }
    }
    return best;
  }

  tryMerge(tipPos, tipDir, state, segments) {
    if (state.mergeCD > 0) return false;

    // 1순위: 기존 노드와 연결
    const nearNode = this.findNearNode(tipPos, mergeRadius);
    if (nearNode) {
      const dir = new THREE.Vector3().subVectors(nearNode.pos, tipPos).normalize();
      const angle = tipDir.angleTo(dir);
      if (angle < mergeAngleTol) {
        // 브릿지 생성
        const mid = tipPos.clone().add(nearNode.pos).multiplyScalar(0.5);
        segments.push({
          start: tipPos.clone(),
          end: mid.clone(),
          radius: state.radius * 0.5,
          gen: state.generation,
          type: "bridge",
        });
        segments.push({
          start: mid.clone(),
          end: nearNode.pos.clone(),
          radius: state.radius * 0.4,
          gen: state.generation,
          type: "stabilize",
        });
        nearNode.degree++;
        return true;
      }
    }

    // 2순위: 다른 tip과 연결
    const nearTip = this.findNearTip(tipPos, mergeRadius);
    if (nearTip) {
      const mid = tipPos.clone().add(nearTip.pos).multiplyScalar(0.5);
      segments.push({
        start: tipPos.clone(),
        end: mid.clone(),
        radius: state.radius * 0.5,
        gen: state.generation,
        type: "bridge",
      });
      segments.push({
        start: mid.clone(),
        end: nearTip.pos.clone(),
        radius: state.radius * 0.5,
        gen: state.generation,
        type: "bridge",
      });
      const newNode = this.addNode(mid, false);
      nearTip.degree++;
      this.edges.push({ from: state.nodeID, to: newNode });
      return true;
    }

    return false;
  }

  deactivateTip(nodeID) {
    for (const n of this.nodes) {
      if (n.id === nodeID) {
        n.tipActive = false;
        break;
      }
    }
  }
}

/* ========================= 
 * 인터프리터: 문자열 → 기하학
 * ========================= */
function interpret(lstring, graph) {
  const segments = [];
  const charges = [];  // 전하 구슬 위치
  const stack = [];
  
  const angleRad = (angleDeg * Math.PI) / 180.0;
  const rootPos = new THREE.Vector3(0, 0, 0);
  const rootDir = new THREE.Vector3(0, 1, 0);
  const rootUp = new THREE.Vector3(0, 0, 1);
  let state = new TurtleState(rootPos, rootDir, rootUp, baseRadius, 0, 0, 0);
  
  const rootNode = graph.addNode(rootPos, false);
  state.nodeID = rootNode;

  for (let i = 0; i < lstring.length; i++) {
    const c = lstring[i];
    
    switch (c) {
      case "F": {
        // 전진: 가지 그리기
        if (shouldCoil()) {
          // 휴면: coil (나선형 말림)
          const coilSteps = 6;
          const coilRadius = step * 0.2;
          const coilHeight = step * 0.5;
          for (let j = 0; j < coilSteps; j++) {
            const t = j / coilSteps;
            const angle = t * Math.PI * 2;
            const offset = new THREE.Vector3(
              Math.cos(angle) * coilRadius,
              t * coilHeight,
              Math.sin(angle) * coilRadius
            );
            const worldOffset = offset.applyQuaternion(
              new THREE.Quaternion().setFromUnitVectors(
                new THREE.Vector3(0, 1, 0),
                state.dir
              )
            );
            const nextPos = state.pos.clone().add(worldOffset);
            segments.push({
              start: state.pos.clone(),
              end: nextPos.clone(),
              radius: state.radius * (1 - t * 0.3),
              gen: state.generation,
              type: "coil",
            });
            state.pos.copy(nextPos);
          }
        } else {
          // 정상 성장
          const bias = getDirectionBias(state.pos);
          const right = new THREE.Vector3().crossVectors(state.dir, state.up).normalize();
          state.dir.add(right.multiplyScalar(bias)).normalize();
          
          const actualStep = step * scaleY * getGrowthBoost();
          const nextPos = state.pos.clone().add(state.dir.clone().multiplyScalar(actualStep));
          
          segments.push({
            start: state.pos.clone(),
            end: nextPos.clone(),
            radius: state.radius,
            gen: state.generation,
            type: "normal",
          });
          
          state.pos.copy(nextPos);
          state.radius *= radiusDecay;
          state.generation++;
          
          // Y축 회전 누적(twist)
          const twist = new THREE.Quaternion().setFromAxisAngle(state.dir, twistY);
          state.up.applyQuaternion(twist);
        }
        break;
      }
      case "+": {
        // 오른쪽(시계) 회전
        const right = new THREE.Vector3().crossVectors(state.dir, state.up).normalize();
        const actualAngle = angleRad * (1 + (Math.random() - 0.5) * asymmetry);
        const q = new THREE.Quaternion().setFromAxisAngle(right, actualAngle);
        state.dir.applyQuaternion(q).normalize();
        state.up.applyQuaternion(q).normalize();
        break;
      }
      case "-": {
        // 왼쪽(반시계) 회전
        const right = new THREE.Vector3().crossVectors(state.dir, state.up).normalize();
        const actualAngle = angleRad * (1 + (Math.random() - 0.5) * asymmetry);
        const q = new THREE.Quaternion().setFromAxisAngle(right, -actualAngle);
        state.dir.applyQuaternion(q).normalize();
        state.up.applyQuaternion(q).normalize();
        break;
      }
      case "[": {
        // 상태 저장(push)
        stack.push(state.clone());
        break;
      }
      case "]": {
        // 상태 복원(pop)
        if (stack.length > 0) {
          // Merge 시도 (tip 종료 시)
          if (state.mergeCD === 0) {
            const merged = graph.tryMerge(state.pos, state.dir, state, segments);
            if (merged) {
              graph.deactivateTip(state.nodeID);
            }
          }
          
          // 전하 구슬 생성 조건
          if (shouldSpawnCharge(state)) {
            charges.push({
              pos: state.pos.clone(),
              radius: state.radius * 3.5,  // 크기 크게 (1.5 → 3.5)
            });
          }
          
          state = stack.pop();
          state.mergeCD = Math.max(0, state.mergeCD - 1);
        }
        break;
      }
      default:
        break;
    }
  }
  
  return { segments, charges };
}

/* ========================= 
 * 세그먼트 → Three.js 지오메트리
 * ========================= */
function segmentsToGeometry(segments) {
  const positions = [];
  const indices = [];
  const colors = [];
  const radialSegs = 6;
  
  let vertexOffset = 0;
  
  for (const seg of segments) {
    const { start, end, radius, gen, type } = seg;
    const dir = new THREE.Vector3().subVectors(end, start).normalize();
    const perpVec = Math.abs(dir.y) < 0.99
      ? new THREE.Vector3(0, 1, 0)
      : new THREE.Vector3(1, 0, 0);
    const right = new THREE.Vector3().crossVectors(dir, perpVec).normalize();
    const up = new THREE.Vector3().crossVectors(right, dir).normalize();
    
    // 색상: 세대/타입별
    let baseColor = new THREE.Color();
    if (type === "coil") {
      baseColor.setHex(0xff6b35); // 주황(휴면)
    } else if (type === "bridge" || type === "stabilize") {
      baseColor.setHex(0x00d9ff); // 시안(그물)
    } else {
      // 일반: 구리 → 금색 그라데이션
      const t = Math.min(1, gen / genMax);
      baseColor.lerpColors(
        new THREE.Color(0xb87333), // 구리
        new THREE.Color(0xffd700), // 금색
        t
      );
    }
    
    // 투명도: 세대마다 감소
    const alpha = Math.pow(decay, gen);
    
    // 링 생성(start, end)
    for (let ring = 0; ring < 2; ring++) {
      const pos = ring === 0 ? start : end;
      const r = radius * (ring === 0 ? 1.0 : 0.85);
      
      for (let i = 0; i < radialSegs; i++) {
        const angle = (i / radialSegs) * Math.PI * 2;
        const x = Math.cos(angle) * r;
        const z = Math.sin(angle) * r;
        const offset = right.clone().multiplyScalar(x).add(up.clone().multiplyScalar(z));
        const vertPos = pos.clone().add(offset);
        
        positions.push(vertPos.x, vertPos.y, vertPos.z);
        colors.push(baseColor.r, baseColor.g, baseColor.b, alpha);
      }
    }
    
    // 인덱스 생성(삼각형 메쉬)
    for (let i = 0; i < radialSegs; i++) {
      const next = (i + 1) % radialSegs;
      const a = vertexOffset + i;
      const b = vertexOffset + next;
      const c = vertexOffset + radialSegs + i;
      const d = vertexOffset + radialSegs + next;
      
      indices.push(a, b, c);
      indices.push(b, d, c);
    }
    
    vertexOffset += radialSegs * 2;
  }
  
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 4));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  
  return geometry;
}

/* ========================= 
 * 전하 구슬 지오메트리
 * ========================= */
function chargesToGeometry(charges) {
  if (charges.length === 0) return null;
  
  const sphereGeom = new THREE.SphereGeometry(1, 8, 6);
  const geometries = [];
  
  for (const ch of charges) {
    const g = sphereGeom.clone();
    g.scale(ch.radius, ch.radius, ch.radius);
    g.translate(ch.pos.x, ch.pos.y, ch.pos.z);
    geometries.push(g);
  }
  
  const merged = BufferGeometryUtils.mergeGeometries(geometries);
  return merged;
}

/* ========================= 
 * 애니메이션: 세그먼트 점진적 성장
 * ========================= */
class GrowthAnimator {
  constructor(segments, geometry, autoStart = true) {
    this.segments = segments;
    this.geometry = geometry;
    this.totalSegs = segments.length;
    this.visibleSegs = 0;
    this.targetSegs = 0;
    this.speed = animateSpeed;  // 세그먼트/초
    this.paused = !autoStart;
    
    // 초기: 원본 위치 저장
    const pos = this.geometry.attributes.position;
    this.originalPositions = pos.array.slice();
    
    if (autoStart) {
      // 자동 시작: 즉시 성장 시작
      this.visibleSegs = 0;
      this.targetSegs = 0;
    } else {
      // 수동: 모두 숨김
      this.hideAll();
    }
  }
  
  hideAll() {
    const pos = this.geometry.attributes.position;
    const original = pos.array.slice();
    this.originalPositions = original;
    
    for (let i = 0; i < pos.count; i++) {
      pos.setXYZ(i, 0, -1000, 0); // 화면 밖으로
    }
    pos.needsUpdate = true;
  }
  
  setVisible(count) {
    count = Math.min(count, this.totalSegs);
    const pos = this.geometry.attributes.position;
    const radialSegs = 6;
    const vertsPerSeg = radialSegs * 2;
    
    for (let s = 0; s < this.totalSegs; s++) {
      const baseIdx = s * vertsPerSeg;
      const visible = s < count;
      
      for (let v = 0; v < vertsPerSeg; v++) {
        const idx = baseIdx + v;
        if (visible) {
          pos.setXYZ(
            idx,
            this.originalPositions[idx * 3 + 0],
            this.originalPositions[idx * 3 + 1],
            this.originalPositions[idx * 3 + 2]
          );
        } else {
          pos.setXYZ(idx, 0, -1000, 0);
        }
      }
    }
    
    pos.needsUpdate = true;
    this.visibleSegs = count;
  }
  
  update(dt) {
    if (this.paused) return;
    
    this.targetSegs += this.speed * dt;
    const target = Math.floor(this.targetSegs);
    
    if (target > this.visibleSegs) {
      this.setVisible(target);
    }
  }
  
  reset() {
    this.visibleSegs = 0;
    this.targetSegs = 0;
    this.hideAll();
  }
  
  togglePause() {
    this.paused = !this.paused;
  }
}

/* ========================= 
 * 메인: L-System 생성 및 장면 추가
 * ========================= */
export function createLSystem(scene, params = {}) {
  // 파라미터 병합
  if (params.angleDeg !== undefined) angleDeg = params.angleDeg;
  if (params.decay !== undefined) decay = params.decay;
  if (params.genMax !== undefined) genMax = params.genMax;
  if (params.step !== undefined) step = params.step;
  if (params.baseRadius !== undefined) baseRadius = params.baseRadius;
  if (params.animateSpeed !== undefined) animateSpeed = params.animateSpeed;
  
  if (params.scaleY !== undefined) scaleY = params.scaleY;
  if (params.scaleX !== undefined) scaleX = params.scaleX;
  if (params.radiusDecay !== undefined) radiusDecay = params.radiusDecay;
  if (params.branchProb !== undefined) branchProb = params.branchProb;
  if (params.bendFactor !== undefined) bendFactor = params.bendFactor;
  if (params.twistY !== undefined) twistY = params.twistY;
  if (params.asymmetry !== undefined) asymmetry = params.asymmetry;
  
  // 환경 자극
  heatLevel = params.heatLevel ?? 0.3;
  electricNoise = params.electricNoise ?? 0.2;
  ioVibration = params.ioVibration ?? 0.1;
  idleCycles = params.idleCycles ?? 0;
  
  // 그물 파라미터
  if (params.mergeRadius !== undefined) mergeRadius = params.mergeRadius;
  if (params.mergeAngleTol !== undefined) mergeAngleTol = params.mergeAngleTol;
  
  // 1) 문자열 생성
  const axiom = "F";
  const lstring = applyRules(axiom, genMax);
  console.log(`[L-System] Gen=${genMax}, Length=${lstring.length}`);
  
  // 2) 그물 그래프
  const graph = new MergeGraph();
  
  // 3) 인터프리터
  const { segments, charges } = interpret(lstring, graph);
  console.log(`[L-System] Segments=${segments.length}, Charges=${charges.length}, Nodes=${graph.nodes.length}`);
  
  // 4) 지오메트리 생성
  const plantGeom = segmentsToGeometry(segments);
  console.log(`[L-System] 지오메트리 생성: vertices=${plantGeom.getAttribute('position')?.count || 0}`);
  
  const plantMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.95,
    side: THREE.DoubleSide,
    roughness: 0.4,
    metalness: 0.6,
    emissive: new THREE.Color(0x222222),
    emissiveIntensity: 0.3,
  });
  const plantMesh = new THREE.Mesh(plantGeom, plantMat);
  plantMesh.position.set(params.posX ?? 0, params.posY ?? 0, params.posZ ?? 0);
  scene.add(plantMesh);
  console.log(`[L-System] 메쉬 위치: (${plantMesh.position.x}, ${plantMesh.position.y}, ${plantMesh.position.z})`);
  
  // 5) 전하 구슬 (발광 효과)
  let chargeMesh = null;
  if (charges.length > 0) {
    const chargeGeom = chargesToGeometry(charges);
    const chargeMat = new THREE.MeshStandardMaterial({
      color: 0x00ffff,          // 시안 (전류 느낌)
      emissive: 0x00aaff,       // 발광: 밝은 파랑
      emissiveIntensity: 1.2,   // 발광 강도
      transparent: true,
      opacity: 0.85,
      roughness: 0.2,
      metalness: 0.8,
    });
    chargeMesh = new THREE.Mesh(chargeGeom, chargeMat);
    chargeMesh.position.copy(plantMesh.position);
    scene.add(chargeMesh);
    console.log(`[L-System] 전하 구슬 ${charges.length}개 생성`);
  } else {
    console.log(`[L-System] 전하 구슬 생성 조건 미충족 (idleCycles=${idleCycles})`);
  }
  
  // 6) 애니메이터 (자동 시작)
  const animator = new GrowthAnimator(segments, plantGeom, true);
  
  return {
    plantMesh,
    chargeMesh,
    animator,
    regenerate: (newParams) => {
      scene.remove(plantMesh);
      if (chargeMesh) scene.remove(chargeMesh);
      return createLSystem(scene, { ...params, ...newParams });
    },
  };
}

/* ========================= 
 * 키보드 컨트롤 (여러 식물 동시 제어)
 * ========================= */
let _controlsSetup = false;
export function setupLSystemControls(lsysArray, recreateCallback) {
  if (_controlsSetup) return; // 중복 등록 방지
  _controlsSetup = true;
  
  window.addEventListener("keydown", (e) => {
    switch (e.code) {
      case "Space":
        // 모든 식물 재생/정지 토글
        if (Array.isArray(lsysArray)) {
          const firstPaused = lsysArray[0]?.animator?.paused ?? false;
          for (const lsys of lsysArray) {
            if (lsys?.animator) lsys.animator.paused = !firstPaused;
          }
          console.log(`[L-System] 전체 ${!firstPaused ? "일시정지" : "재생"}`);
        } else {
          lsysArray.animator.togglePause();
          console.log(`[L-System] ${lsysArray.animator.paused ? "일시정지" : "재생"}`);
        }
        break;
      case "BracketLeft": // [
        genMax = Math.max(1, genMax - 1);
        console.log(`[L-System] genMax=${genMax}`);
        recreateCallback();
        break;
      case "BracketRight": // ]
        genMax = Math.min(8, genMax + 1);
        console.log(`[L-System] genMax=${genMax}`);
        recreateCallback();
        break;
      case "KeyJ":
        angleDeg = Math.max(5, angleDeg - 3);
        console.log(`[L-System] angleDeg=${angleDeg.toFixed(1)}°`);
        recreateCallback();
        break;
      case "KeyK":
        angleDeg = Math.min(60, angleDeg + 3);
        console.log(`[L-System] angleDeg=${angleDeg.toFixed(1)}°`);
        recreateCallback();
        break;
      case "KeyN":
        decay = Math.max(0.5, decay - 0.05);
        console.log(`[L-System] decay=${decay.toFixed(2)}`);
        recreateCallback();
        break;
      case "KeyM":
        decay = Math.min(0.99, decay + 0.05);
        console.log(`[L-System] decay=${decay.toFixed(2)}`);
        recreateCallback();
        break;
    }
  });
}

/* ========================= 
 * 환경 자극 동적 제어 (전하 구슬 색상 변화)
 * ========================= */
export function setupEnvironmentControls() {
  window.addEventListener("keydown", (e) => {
    let changed = false;
    switch (e.code) {
      case "KeyH": // Heat +
        heatLevel = Math.min(1.0, heatLevel + 0.1);
        console.log(`🔥 [열] heatLevel=${heatLevel.toFixed(2)} ${heatLevel > 0.75 ? "(과열!)" : ""}`);
        changed = true;
        break;
      case "KeyG": // Heat -
        heatLevel = Math.max(0.0, heatLevel - 0.1);
        console.log(`❄️ [열] heatLevel=${heatLevel.toFixed(2)} ${heatLevel < 0.4 ? "(냉각)" : ""}`);
        changed = true;
        break;
      case "KeyE": // Electric +
        electricNoise = Math.min(1.0, electricNoise + 0.1);
        console.log(`⚡ [전류] electricNoise=${electricNoise.toFixed(2)} ${electricNoise > 0.6 ? "(높음!)" : ""}`);
        changed = true;
        break;
      case "KeyQ": // Electric -
        electricNoise = Math.max(0.0, electricNoise - 0.1);
        console.log(`🔌 [전류] electricNoise=${electricNoise.toFixed(2)}`);
        changed = true;
        break;
      case "KeyI": // Idle +
        idleCycles = Math.min(20, idleCycles + 2);
        console.log(`💤 [정적] idleCycles=${idleCycles} ${idleCycles > 12 ? "(장기 정적!)" : ""}`);
        changed = true;
        break;
      case "KeyU": // Idle -
        idleCycles = Math.max(0, idleCycles - 2);
        console.log(`🔄 [정적] idleCycles=${idleCycles}`);
        changed = true;
        break;
    }
    
    if (changed && e.code === "KeyH" && heatLevel === 1.0) {
      console.log("⚠️ [경고] 최대 과열! 식물이 휴면 상태로 진입할 수 있습니다.");
    }
  });
}

// 현재 환경 상태 반환 (전하 구슬 색상 결정용)
export function getEnvironmentState() {
  return { heatLevel, electricNoise, idleCycles };
}

