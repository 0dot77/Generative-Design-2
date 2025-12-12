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
  slimeParams,
} from "./boids.js";
import { initPlants, updatePlants, getPlants } from "./plants.js";
import { initInteraction, updateInteraction } from "./interaction.js";
import { GeneticAlgorithm } from "./ga.js";
const Tone = window.Tone;

if (!Tone) {
  console.error(
    "[audio] Tone.js가 로드되지 않았습니다. index.html 스크립트 순서를 확인하세요."
  );
}

/* ========================= 
 * 에이전트 기반 사운드 유틸
 * ========================= */
function playAgentSoundFromValue(value) {
  if (!Tone) {
    console.warn(
      "[audio] Tone.js가 로드되지 않아서 에이전트 사운드를 재생할 수 없습니다."
    );
    return;
  }

  // 브라우저 오디오 정책: 최초 한 번은 사용자 제스처 안에서 Tone.start()가 호출되어야 함.
  // 여기서는 컨텍스트가 이미 running인지 확인만 하고, 아니면 조용히 패스한다.
  if (Tone.getContext().state !== "running") {
    // console.warn("[audio] AudioContext가 아직 running 상태가 아니라서 사운드를 건너뜁니다.");
    return;
  }

  // 1) 값 클램프 (0~10)
  const v = Math.max(0, Math.min(10, value || 0));

  // 2) 에너지(0~10) -> 필터 컷오프 기본값 (300Hz ~ 8000Hz)
  const minCutoff = 300;
  const maxCutoff = 8000;
  const baseCutoff = minCutoff + (v / 10) * (maxCutoff - minCutoff);

  // 3) "움직일 때마다 랜덤한 값을 갖는 것처럼" 들리도록, 컷오프에 랜덤 지터 추가
  const jitterAmount = 0.6; // 0.0~1.0 정도 (0.6이면 ±30% 정도 출렁)
  const jitterFactor = 1 + (Math.random() - 0.5) * jitterAmount;
  const targetCutoff = Math.max(200, Math.min(12000, baseCutoff * jitterFactor));

  // 4) 싱글톤 Synth + Filter 생성 (매 호출마다 새로 만드는 대신 재사용)
  if (!playAgentSoundFromValue._filter || !playAgentSoundFromValue._synth) {
    const filter = new Tone.Filter(800, "lowpass").toDestination();

    const synth = new Tone.Synth({
      oscillator: { type: "triangle" },
      envelope: {
        attack: 0.005,
        decay: 0.12,
        sustain: 0.0,
        release: 0.15,
      },
    }).connect(filter);

    playAgentSoundFromValue._filter = filter;
    playAgentSoundFromValue._synth = synth;
  }

  const filter = playAgentSoundFromValue._filter;
  const synth = playAgentSoundFromValue._synth;

  // 5) 음 높이도 완전 랜덤이지만 음악적으로 들리도록 제한된 스케일 사용 (C 메이저 펜타토닉)
  const scale = ["C4", "D4", "E4", "G4", "A4", "C5"];
  const idx = Math.floor(Math.random() * scale.length);
  const note = scale[idx];

  // 6) Tone.js 오디오 타임 기준으로 짧은 사운드 + filter sweep 스케줄링
  const now = Tone.now();

  // 이전에 예약된 filter frequency 변경을 지우고, 짧게 목표 cutoff로 램프
  filter.frequency.cancelScheduledValues(now);
  filter.frequency.linearRampToValueAtTime(targetCutoff, now + 0.03);

  // 짧은 음 한 번 재생
  synth.triggerAttackRelease(note, "16n", now);
}

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
  // 씬과 렌더러가 모두 준비된 뒤에 클릭 사운드 리스너 등록
  setupAudioDebugClickSound();
  animate();
});

/* ========================= 
 * 전역 노출 (디버깅용)
 * ========================= */
if (typeof window !== "undefined") {
  window.appState = state;
  window.THREE = THREE;
  window.triggerNextGeneration = triggerNextGeneration;
  window.playAgentSoundFromValue = playAgentSoundFromValue;
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

  // ───────────────────────────────
  // Slime / Trail & Sensing 파라미터 HUD
  // ───────────────────────────────
  const fSlime = gui.addFolder("Slime / Trail");
  fSlime
    .add(slimeParams, "TRAIL_DEPOSIT_AMOUNT", 0.1, 3.0, 0.05)
    .name("Trail Deposit");
  fSlime
    .add(slimeParams, "TRAIL_DECAY_RATE", 0.90, 0.995, 0.0005)
    .name("Trail Decay");
  fSlime
    .add(slimeParams, "W_TRAIL_FOLLOW", 0.0, 10.0, 0.1)
    .name("Trail Follow");
  fSlime
    .add(slimeParams, "SENSOR_DISTANCE", 2, 40, 0.5)
    .name("Sensor Dist");

  // SENSOR_ANGLE은 라디안 값이지만, 사용성을 위해 대략 15~90도에 해당하는 범위로 제한
  const deg15 = THREE.MathUtils.degToRad(15);
  const deg90 = THREE.MathUtils.degToRad(90);
  fSlime
    .add(slimeParams, "SENSOR_ANGLE", deg15, deg90, THREE.MathUtils.degToRad(1))
    .name("Sensor Angle (rad)");
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

  // 새 세대 population 요약 (fitness는 이전 세대 기준)
  updateGASummary(newPop, null, state.generation);

  console.log(
    `[GA] Generation ${state.generation} nextGeneration 적용 (doomed=${doomed.length})`
  );
}


// 렌더러 클릭할 때마다 항상 "띵" 소리 (랜덤 음정)
function setupAudioDebugClickSound() {
  if (!Tone) {
    console.warn("[audio] Tone.js가 없어서 클릭 사운드를 설정하지 못했습니다.");
    return;
  }

  if (!state.renderer || !state.renderer.domElement) {
    console.warn("[audio] renderer가 아직 준비되지 않아 클릭 사운드를 설정하지 못했습니다.");
    return;
  }

  const canvas = state.renderer.domElement;

  // 클릭 시 사용할 음계 (듣기 좋은 C 메이저 펜타토닉)
  const notes = ["C4", "D4", "E4", "G4", "A4", "C5"];

  canvas.addEventListener("pointerdown", async (ev) => {
    console.log("[audio] pointerdown:", ev.type);

    try {
      // 오디오 컨텍스트 시작 + 강제 resume
      await Tone.start();
      await Tone.getContext().resume();
      console.log("[audio] AudioContext state =", Tone.getContext().state);

      // 클릭할 때마다 새 Synth 생성 → 항상 안전하게 소리 남
      const clickSynth = new Tone.Synth().toDestination();

      // 랜덤 음 선택
      const idx = Math.floor(Math.random() * notes.length);
      const note = notes[idx];

      console.log("[audio] trigger note:", note);
      clickSynth.triggerAttackRelease(note, "8n");
    } catch (err) {
      console.error("[audio] Tone.start() / resume 실패:", err);
    }
  });
}