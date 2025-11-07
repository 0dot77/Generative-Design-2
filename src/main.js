// main.js - 전체 애플리케이션 통합 및 관리
import * as THREE from "three";
import { createScene, setupLights, setupControls, setupResize } from "./scene.js";
import { createHUD } from "./hud.js";
import { createTerrain } from "./terrain.js";
import { initBoids, updateBoids } from "./boids.js";
import { initPlants, updatePlants } from "./plants.js";

/* ========================= 
 * 애플리케이션 상태
 * ========================= */
const state = {
  scene: null,
  camera: null,
  renderer: null,
  controls: null,
  terrain: null,
  hud: null,
  clock: new THREE.Clock(),
  boidsReady: false,
  plantsReady: false,
};

/* ========================= 
 * 초기화
 * ========================= */
async function init() {
  console.log("[Main] 애플리케이션 초기화 시작...");

  // 1. Scene, Camera, Renderer 설정
  const { scene, camera, renderer } = createScene();
  state.scene = scene;
  state.camera = camera;
  state.renderer = renderer;

  // 2. 라이트 설정
  setupLights(scene);

  // 3. 컨트롤 설정
  state.controls = setupControls(camera, renderer.domElement);

  // 4. 리사이즈 핸들러
  setupResize(camera, renderer);

  // 5. HUD 생성
  state.hud = createHUD();

  // 6. 지형 생성
  console.log("[Main] 지형 생성 중...");
  state.terrain = await createTerrain({
    width: 200,
    depth: 200,
    res: 256,
    heightScale: 18,
    seaLevel: 0.48,
    heightmapUrl: null,
    renderer,
    aisleW: 0.12,
  });
  scene.add(state.terrain.mesh);
  console.log("[Main] ✅ 지형 생성 완료");

  // 7. Boids 초기화
  console.log("[Main] Boids 초기화 중...");
  state.boidsReady = await initBoids(scene, state.terrain);
  if (state.boidsReady) {
    console.log("[Main] ✅ Boids 초기화 완료");
  }

  // 8. 식물 초기화
  console.log("[Main] 식물 초기화 중...");
  initPlants(scene, state.terrain);
  state.plantsReady = true;
  console.log("[Main] ✅ 식물 초기화 완료");

  console.log("[Main] 🎉 모든 초기화 완료!");
  console.log("[Main] 애니메이션 루프 시작...");
}

/* ========================= 
 * 애니메이션 루프
 * ========================= */
let loopLogged = false;

function animate() {
  requestAnimationFrame(animate);
  const t0 = performance.now();

  const dt = state.clock.getDelta();
  const time = state.clock.getElapsedTime();

  // 컨트롤 업데이트
  state.controls.update();

  // Boids 업데이트
  if (state.boidsReady) {
    updateBoids(dt);
  }

  // 식물 업데이트
  if (state.plantsReady) {
    updatePlants(time, dt);
  }

  // 렌더링
  state.renderer.render(state.scene, state.camera);

  // HUD 업데이트
  const frameTime = performance.now() - t0;
  state.hud.update(frameTime);

  // 첫 프레임 로그
  if (!loopLogged) {
    console.log("[Main] 애니메이션 루프 실행 중");
    loopLogged = true;
  }
}

/* ========================= 
 * 시작
 * ========================= */
init().then(() => {
  animate();
});

/* ========================= 
 * 전역 노출 (디버깅용)
 * ========================= */
if (typeof window !== "undefined") {
  window.appState = state;
  window.THREE = THREE;
}

