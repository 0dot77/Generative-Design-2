# 프로젝트 아키텍처

## 🏗️ 전체 구조

```
┌─────────────────────────────────────────┐
│           index.html                     │
│    (진입점 - main.js 로드)               │
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│           main.js                        │
│  • 전체 초기화 관리                      │
│  • 애니메이션 루프                       │
│  • 모듈 통합                             │
└──┬────┬────┬────┬────┬───────────────────┘
   │    │    │    │    │
   │    │    │    │    └──────┐
   │    │    │    │           │
   ▼    ▼    ▼    ▼           ▼
┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐
│scene │ │ hud  │ │terrain│ │boids │ │plants│
│ .js  │ │ .js  │ │ .js  │ │ .js  │ │ .js  │
└──────┘ └──────┘ └──┬───┘ └──────┘ └──┬───┘
                     │                  │
                     │                  ▼
                     │            ┌──────────┐
                     │            │ lsystem  │
                     │            │   .js    │
                     │            └────┬─────┘
                     │                 │
                     ▼                 ▼
                ┌──────────────────────────┐
                │   shaders/               │
                │ • terrain.vert.glsl      │
                │ • terrain.frag.glsl      │
                │ • rd_*.glsl              │
                └──────────────────────────┘
```

## 📦 모듈 의존성

### main.js (루트)
```javascript
import { createScene, setupLights, setupControls, setupResize } from './scene.js'
import { createHUD } from './hud.js'
import { createTerrain } from './terrain.js'
import { initBoids, updateBoids } from './boids.js'
import { initPlants, updatePlants } from './plants.js'
```

### boids.js
```javascript
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js'

// 외부 의존: terrain 객체 (initBoids 시 전달)
```

### plants.js
```javascript
import * as THREE from 'three'
import { createLSystem, setupLSystemControls, setupEnvironmentControls, getEnvironmentState } from './lsystem.js'

// 외부 의존: scene, terrain (initPlants 시 전달)
```

### lsystem.js
```javascript
import * as THREE from 'three'
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js'

// 독립 모듈 (외부 의존성 없음)
```

### terrain.js
```javascript
import * as THREE from 'three'

// 독립 모듈 (GLSL 파일 fetch)
```

### scene.js
```javascript
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

// 독립 모듈
```

### hud.js
```javascript
// 순수 JavaScript (Three.js 의존 없음)
```

---

## 🔄 데이터 흐름

### 초기화 단계

```
1. main.js 시작
   ↓
2. createScene() → scene, camera, renderer
   ↓
3. setupLights(scene) → 라이트 추가
   ↓
4. setupControls() → OrbitControls
   ↓
5. createHUD() → FPS 표시
   ↓
6. createTerrain() → 지형 생성
   ↓
7. initBoids(scene, terrain) → Boids 초기화
   ↓
8. initPlants(scene, terrain) → 식물 초기화
   ↓
9. animate() 루프 시작
```

### 애니메이션 루프

```
animate() 매 프레임:
  ↓
  1. clock.getDelta() → dt 계산
  ↓
  2. controls.update() → 카메라 컨트롤
  ↓
  3. updateBoids(dt)
     - Boids 알고리즘 실행
     - 지형 경계 제한
     - 표면 추종
     - InstancedMesh 업데이트
  ↓
  4. updatePlants(time, dt)
     - 각 식물 animator.update(dt)
     - 전하 구슬 애니메이션
     - 환경 반응 (색상/발광)
  ↓
  5. renderer.render(scene, camera)
  ↓
  6. hud.update(frameTime) → FPS 갱신
  ↓
  7. requestAnimationFrame(animate)
```

---

## 🎯 주요 책임 분리

| 모듈 | 책임 | 외부 의존 |
|---|---|---|
| **main.js** | 전체 통합, 초기화 순서, 루프 | 모든 모듈 |
| **scene.js** | Three.js 씬 설정 | Three.js, OrbitControls |
| **hud.js** | UI 표시 (FPS) | 없음 |
| **terrain.js** | 지형 생성, 샘플링 | Three.js, GLSL |
| **boids.js** | 군집 알고리즘, 충돌/경계 | GLTFLoader, terrain |
| **plants.js** | 식물 배치, 환경 반응 | lsystem.js, terrain |
| **lsystem.js** | L-System 규칙, 생성 | BufferGeometryUtils |

---

## 🔌 인터페이스

### terrain.js
```javascript
export async function createTerrain(options) → {
  mesh: THREE.Mesh,
  uniforms: { seaLevel, heightScale, ... },
  heightAtXZ: (x, z) → float,
  normalAtXZ: (x, z) → Vector3,
  worldToUV: (x, z) → { u, v }
}
```

### boids.js
```javascript
export async function initBoids(scene, terrain) → boolean
export function updateBoids(dt) → void
export function getBoidsConfig() → CONFIG
```

### plants.js
```javascript
export function initPlants(scene, terrain) → void
export function updatePlants(time, dt) → void
export function getPlants() → Array<LSystem>
```

### lsystem.js
```javascript
export function createLSystem(scene, params) → {
  plantMesh: THREE.Mesh,
  chargeMesh: THREE.Mesh,
  animator: GrowthAnimator,
  regenerate: (newParams) → LSystem
}

export function setupLSystemControls(lsysArray, recreateCallback) → void
export function setupEnvironmentControls() → void
export function getEnvironmentState() → { heatLevel, electricNoise, idleCycles }
```

### scene.js
```javascript
export function createScene() → { scene, camera, renderer }
export function setupLights(scene) → { hemi, dir }
export function setupControls(camera, domElement) → OrbitControls
export function setupResize(camera, renderer) → void
```

### hud.js
```javascript
export function createHUD() → {
  element: HTMLElement,
  update: (frameTime) → void
}
```

---

## 🎛️ 설정 가능 파라미터

### main.js
- 지형 크기 (width, depth, res)
- heightScale, seaLevel
- aisleW (복도 폭)

### boids.js - CONFIG
- count, maxSpeed, maxForce
- neighborRadius, separationRadius
- alignWeight, cohesionWeight, separationWeight
- scale (크기)

### plants.js
- plantCount (식물 개수)
- 각 식물의 랜덤 범위:
  - genMax: 3~5
  - angleDeg: 25~38
  - step: 1.8~3.0
  - baseRadius: 0.18~0.28

### lsystem.js (전역 파라미터)
- angleDeg, decay, genMax, step, baseRadius
- heatLevel, electricNoise, idleCycles
- mergeRadius, mergeAngleTol

---

## 🚦 상태 관리

### main.js - state 객체
```javascript
{
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  renderer: THREE.WebGLRenderer,
  controls: OrbitControls,
  terrain: Terrain,
  hud: HUD,
  clock: THREE.Clock,
  boidsReady: boolean,
  plantsReady: boolean
}
```

### boids.js (모듈 내부)
```javascript
_boidInst: THREE.InstancedMesh
_pos: Array<Vector3>
_vel: Array<Vector3>
_acc: Array<Vector3>
_terrain: Terrain
```

### plants.js (모듈 내부)
```javascript
_lsystems: Array<LSystem>
_terrain: Terrain
_scene: THREE.Scene
```

---

## 🔐 캡슐화 원칙

1. **모듈 내부 상태는 외부 노출 금지** (언더스코어 `_` 접두사)
2. **공개 API만 export**
3. **의존성 주입** (initBoids, initPlants에서 scene/terrain 전달)
4. **단일 책임 원칙** (각 모듈은 하나의 기능만)
5. **느슨한 결합** (인터페이스를 통한 통신)

---

## 📈 확장 가능성

### 새 기능 추가 시:

1. **새 모듈 생성** (예: `effects.js`)
2. **공개 API 정의** (`export function initEffects()`)
3. **main.js에 통합**
   ```javascript
   import { initEffects, updateEffects } from './effects.js'
   // init()에서 호출
   // animate()에서 업데이트
   ```
4. **의존성 주입** (필요한 객체를 파라미터로 전달)

### 예: 파티클 시스템 추가

```javascript
// particles.js
export function initParticles(scene, terrain) { ... }
export function updateParticles(dt) { ... }

// main.js
import { initParticles, updateParticles } from './particles.js'

async function init() {
  // ... 기존 코드
  initParticles(scene, state.terrain)
}

function animate() {
  // ... 기존 코드
  updateParticles(dt)
}
```

---

## 🐛 디버깅 팁

1. **콘솔 로그 추적**
   - `[Main]`, `[Boids]`, `[Plants]` 등 접두사로 모듈 구분
   
2. **전역 접근**
   ```javascript
   window.appState  // main.js의 state 객체
   window.THREE     // Three.js 라이브러리
   ```

3. **브레이크포인트**
   - `main.js` → `animate()` 루프
   - `boids.js` → `updateBoidsLogic()`
   - `plants.js` → `updatePlants()`

4. **성능 프로파일링**
   - Chrome DevTools → Performance 탭
   - `hud.js`의 FPS/평균 프레임 시간 확인

