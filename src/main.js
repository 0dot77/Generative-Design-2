// main.js - 전체 애플리케이션 통합 및 관리
import * as THREE from "three";
import GUI from "https://cdn.jsdelivr.net/npm/lil-gui@0.19/+esm";
import { createScene, setupLights, setupControls, setupResize } from "./scene.js";
import { createHUD } from "./hud.js";
import { createTerrain } from "./terrain.js";
import {
  initBoids,
  updateBoids,
  applyPopulationGenomes,
  markSelection,
  markNewborn,
  getBoidsConfig,
  setGenerationTint,
} from "./boids.js";
import { initPlants, updatePlants, getPlants } from "./plants.js";
import { initInteraction, updateInteraction } from "./interaction.js";
import { GeneticAlgorithm } from "./ga.js";

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
  // GA 상태
  ga: null,
  generation: 0,
  autoRun: true,
  generationDuration: 10, // 초
  timeSinceGenStart: 0,
  inTransition: false,
  transitionTimer: 0,
  nextGenApplied: false,
  gaHudStats: null,
};

// GA 타이밍 상수
const SURVIVAL_RATE = 0.4;
const DEATH_ANIM_DURATION = 2.0;
const SURVIVORS_WINDOW = 1.5;
const NEWBORN_ANIM_DURATION = 1.0;

// 세대별 전역 틴트 팔레트 (기존 RD 텍스처 위에 곱해져 세대 톤이 확 달라지도록)
const GENERATION_TINTS = [
  0x4cc9f0, // 밝은 시안
  0xf72585, // 마젠타
  0xffca3a, // 옐로우/오렌지
  0x8ac926, // 라임 그린
  0xff6b6b, // 코럴 레드
];

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

  // 7. GA 초기화 + Boids 초기화
  console.log("[Main] GA + Boids 초기화 중...");
  const boidConfig = getBoidsConfig();
  const populationSize = boidConfig.count;

  // 패턴 슬롯 분포 (0~4 균등)
  const slotPatternIds = new Array(populationSize);
  for (let i = 0; i < populationSize; i++) {
    slotPatternIds[i] = i % 5;
  }

  state.ga = new GeneticAlgorithm({
    populationSize,
    survivalRate: SURVIVAL_RATE,
    mutationRate: 0.15,
    crossoverRate: 1.0,
    slotPatternIds,
  });
  const initialPopulation = state.ga.initPopulation();

  // 초기 세대(0) 전역 틴트 적용
  setGenerationTint(GENERATION_TINTS[0]);

  state.boidsReady = await initBoids(scene, state.terrain, initialPopulation);
  if (state.boidsReady) {
    console.log("[Main] ✅ Boids + GA 초기화 완료 (generation 0)");
  }

  // 8. 식물 초기화
  console.log("[Main] 식물 초기화 중...");
  initPlants(scene, state.terrain);
  state.plantsReady = true;
  console.log("[Main] ✅ 식물 초기화 완료");

  // 9. 마우스 인터랙션 초기화
  console.log("[Main] 마우스 인터랙션 초기화 중...");
  const plants = getPlants();
  initInteraction(camera, scene, plants, renderer);
  console.log("[Main] ✅ 마우스 인터랙션 초기화 완료");

  // 10. GA 제어용 GUI
  setupGAControls();

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

  // GA 타이머/세대 전환 업데이트
  updateGA(dt);

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

  // 마우스 인터랙션 업데이트
  updateInteraction(time, dt);

  // 렌더링
  state.renderer.render(state.scene, state.camera);

  // HUD 업데이트
  const frameTime = performance.now() - t0;
  state.hud.update(frameTime, state.gaHudStats);

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
  window.triggerNextGeneration = triggerNextGeneration;
}

/* ========================= 
 * GA 헬퍼
 * ========================= */

function setupGAControls() {
  const gui = new GUI({ title: "GA - Server Garden" });
  const fGA = gui.addFolder("Genetic Algorithm");
  fGA.add(state, "generationDuration", 1, 60, 1).name("Generation (sec)");
  fGA.add(state, "autoRun").name("Auto Run");
  fGA.add({ next: () => triggerNextGeneration() }, "next").name("Next Generation");
  fGA.add(state, "generation").name("Generation").listen();
}

function updateGASummary(population, evalInfo, generationLabel) {
  if (!population || population.length === 0) return;

  const counts = [0, 0, 0, 0, 0];
  let sumScale = 0;
  let sumSpeed = 0;
  let sumShow = 0;
  let n = 0;

  for (const g of population) {
    if (!g) continue;
    const pid = typeof g.patternId === "number" ? g.patternId : 0;
    if (counts[pid] == null) counts[pid] = 0;
    counts[pid]++;

    sumScale += typeof g.bodyScale === "number" ? g.bodyScale : 1.0;
    sumSpeed += typeof g.baseSpeed === "number" ? g.baseSpeed : 1.0;
    sumShow += typeof g.showOff === "number" ? g.showOff : 0.0;
    n++;
  }

  const stats = state.gaHudStats || {};
  stats.generation = generationLabel;
  stats.patternCounts = counts;
  if (n > 0) {
    stats.avgScale = sumScale / n;
    stats.avgSpeed = sumSpeed / n;
    stats.avgShow = sumShow / n;
  }

  if (evalInfo && Array.isArray(evalInfo.fitness) && evalInfo.fitness.length > 0) {
    stats.bestFitness = Math.max(...evalInfo.fitness);
  }

  state.gaHudStats = stats;
}

function updateGA(dt) {
  if (!state.ga || !state.boidsReady) return;

  // 세대 진행 타이머
  if (!state.inTransition && state.autoRun) {
    state.timeSinceGenStart += dt;
    if (state.timeSinceGenStart >= state.generationDuration) {
      triggerNextGeneration();
    }
  }

  if (!state.inTransition) return;

  state.transitionTimer += dt;

  // 죽는 애니메이션 + 생존자만 보여주는 구간이 끝나면 nextGeneration 적용
  const applyTime = DEATH_ANIM_DURATION + SURVIVORS_WINDOW;
  const endTime = applyTime + NEWBORN_ANIM_DURATION;

  if (!state.nextGenApplied && state.transitionTimer >= applyTime) {
    applyNextGeneration();
    state.nextGenApplied = true;
  }

  if (state.transitionTimer >= endTime) {
    // 한 세대 전환 사이클 완료
    state.inTransition = false;
    state.transitionTimer = 0;
    state.nextGenApplied = false;
    state.timeSinceGenStart = 0;
  }
}

function triggerNextGeneration() {
  if (!state.ga || !state.boidsReady) return;
  if (state.inTransition) return; // 이미 전환 중이면 무시

  const currentGen = state.generation;

  // 1) 평가
  const evalInfo = state.ga.evaluatePopulation();
  const survivors = evalInfo.survivors;
  const doomed = evalInfo.doomed;

  // HUD용 요약 (현재 세대 기준)
  updateGASummary(state.ga.getPopulation(), evalInfo, currentGen);

  // 2) 선택 결과를 보이드에 표시 (dying / alive)
  markSelection(survivors, doomed, DEATH_ANIM_DURATION);

  state.inTransition = true;
  state.transitionTimer = 0;
  state.nextGenApplied = false;
  state.generation += 1;

  console.log(
    `[GA] Generation ${state.generation} evaluate → survivors=${survivors.length}, doomed=${doomed.length}`
  );
}

function applyNextGeneration() {
  const last = state.ga.getLastEvaluationInfo();
  const doomed = last.doomed || [];
  const newPop = state.ga.nextGeneration();

  // doomed 슬롯에만 새 genome 적용
  applyPopulationGenomes(newPop, doomed);
  markNewborn(doomed, NEWBORN_ANIM_DURATION);

  // 새 세대 index에 따라 전역 틴트 변경 (세대별 톤이 확 달라짐)
  const tintIdx = state.generation % GENERATION_TINTS.length;
  setGenerationTint(GENERATION_TINTS[tintIdx]);

  // 새 세대 population 요약 (fitness는 이전 세대 기준)
  updateGASummary(newPop, null, state.generation);

  console.log(
    `[GA] Generation ${state.generation} nextGeneration 적용 (doomed=${doomed.length})`
  );
}


