import * as THREE from "three";

/* ========================= 
 * 상태 관리
 * ========================= */
let _camera = null;
let _scene = null;
let _plants = null; // plants.js에서 받은 식물 배열
let _renderer = null;

// 마우스 상태
const mouseState = {
    position: new THREE.Vector2(), // 화면 좌표 (-1 ~ 1)
    worldPosition: new THREE.Vector3(), // 월드 3D 좌표
    isClicked: false,
    clickRadius: 15.0, // 월드 단위 영향 범위
};

// 휴면 상태 관리
const dormantState = new Map(); // plantMesh.uuid → { startTime, duration }

// 시각화 요소
let cursorCircle = null; // 마우스 커서 원형 표시
let effectCircle = null; // 클릭 효과 원형 표시

/* ========================= 
 * 초기화
 * ========================= */
export function initInteraction(camera, scene, plants, renderer) {
    _camera = camera;
    _scene = scene;
    _plants = plants;
    _renderer = renderer;

    console.log("[Interaction] 마우스 인터랙션 초기화 중...");

    // 1) 마우스 이벤트 리스너 등록
    setupMouseListeners();

    // 2) 시각화 요소 생성
    createVisualElements();

    console.log("[Interaction] ✅ 인터랙션 초기화 완료");
}

/* ========================= 
 * 마우스 이벤트 리스너
 * ========================= */
function setupMouseListeners() {
    const canvas = _renderer.domElement;

    // 마우스 이동
    canvas.addEventListener("mousemove", onMouseMove, false);

    // 마우스 클릭
    canvas.addEventListener("click", onMouseClick, false);

    console.log("[Interaction] 마우스 이벤트 리스너 등록 완료");
}

function onMouseMove(event) {
    const rect = _renderer.domElement.getBoundingClientRect();

    // 정규화된 화면 좌표 (-1 ~ 1)
    mouseState.position.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouseState.position.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    // 월드 좌표로 변환 (레이캐스팅)
    updateWorldPosition();
}

function onMouseClick(event) {
    console.log(`[Interaction] 🖱️ 클릭! 위치: (${mouseState.worldPosition.x.toFixed(1)}, ${mouseState.worldPosition.z.toFixed(1)})`);

    // 범위 내 식물 찾기 및 휴면 상태 적용
    applyDormantState();

    // 클릭 효과 시각화
    showClickEffect();
}

/* ========================= 
 * 월드 좌표 변환 (레이캐스팅)
 * ========================= */
function updateWorldPosition() {
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouseState.position, _camera);

    // 지형과의 교차점 계산 (y=0 평면 사용 - 간단한 방법)
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const intersection = new THREE.Vector3();

    if (raycaster.ray.intersectPlane(plane, intersection)) {
        mouseState.worldPosition.copy(intersection);
    }
}

/* ========================= 
 * 시각화 요소 생성
 * ========================= */
function createVisualElements() {
    // 1) 커서 원형 (네트워크 상태 - 기본)
    const cursorGeometry = new THREE.RingGeometry(
        mouseState.clickRadius - 0.5,
        mouseState.clickRadius,
        32
    );
    const cursorMaterial = new THREE.MeshBasicMaterial({
        color: 0x00d9ff, // 시안 (네트워크)
        transparent: true,
        opacity: 0.4,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false,
    });
    cursorCircle = new THREE.Mesh(cursorGeometry, cursorMaterial);
    cursorCircle.rotation.x = -Math.PI / 2; // 바닥에 평평하게
    cursorCircle.position.y = 0.5; // 약간 띄움
    cursorCircle.renderOrder = 1000; // 항상 위에 렌더링
    _scene.add(cursorCircle);

    // 2) 클릭 효과 원형 (휴면 상태)
    const effectGeometry = new THREE.CircleGeometry(mouseState.clickRadius, 32);
    const effectMaterial = new THREE.MeshBasicMaterial({
        color: 0xff6b35, // 주황 (휴면)
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false,
    });
    effectCircle = new THREE.Mesh(effectGeometry, effectMaterial);
    effectCircle.rotation.x = -Math.PI / 2;
    effectCircle.position.y = 0.3;
    effectCircle.renderOrder = 999;
    _scene.add(effectCircle);

    console.log("[Interaction] 시각화 요소 생성 완료 (커서 원형, 효과 원형)");
}

/* ========================= 
 * 휴면 상태 적용
 * ========================= */
function applyDormantState() {
    if (!_plants || _plants.length === 0) {
        console.warn("[Interaction] 식물 배열이 비어있습니다.");
        return;
    }

    let affectedCount = 0;

    for (const lsys of _plants) {
        if (!lsys || !lsys.plantMesh) continue;

        const plantPos = lsys.plantMesh.position;
        const distance = mouseState.worldPosition.distanceTo(plantPos);

        // 범위 내에 있는 식물만 처리
        if (distance <= mouseState.clickRadius) {
            const uuid = lsys.plantMesh.uuid;

            // 이미 휴면 상태면 시간 연장
            if (dormantState.has(uuid)) {
                const existing = dormantState.get(uuid);
                existing.startTime = performance.now();
                console.log(`[Interaction] 🔄 식물 ${uuid.slice(0, 8)}... 휴면 시간 연장`);
            } else {
                // 새로 휴면 상태 진입
                dormantState.set(uuid, {
                    startTime: performance.now(),
                    duration: 10000, // 10초
                    originalMaterial: lsys.plantMesh.material.clone(), // 원본 저장
                });
                console.log(`[Interaction] 💤 식물 ${uuid.slice(0, 8)}... 휴면 상태 진입`);
            }

            affectedCount++;
        }
    }

    console.log(`[Interaction] ✅ ${affectedCount}개 식물 휴면 상태 적용`);
}

/* ========================= 
 * 클릭 효과 애니메이션
 * ========================= */
function showClickEffect() {
    if (!effectCircle) return;

    effectCircle.position.x = mouseState.worldPosition.x;
    effectCircle.position.z = mouseState.worldPosition.z;
    effectCircle.material.opacity = 0.6;

    // 페이드아웃 애니메이션 (간단한 타이머)
    let opacity = 0.6;
    const fadeInterval = setInterval(() => {
        opacity -= 0.05;
        if (opacity <= 0) {
            opacity = 0;
            clearInterval(fadeInterval);
        }
        effectCircle.material.opacity = opacity;
    }, 50);
}

/* ========================= 
 * 업데이트 (매 프레임)
 * ========================= */
export function updateInteraction(time, dt) {
    // 1) 커서 원형 위치 업데이트
    if (cursorCircle) {
        cursorCircle.position.x = mouseState.worldPosition.x;
        cursorCircle.position.z = mouseState.worldPosition.z;

        // 펄스 효과 (약간의 크기 변화)
        const pulse = 1.0 + Math.sin(time * 2.5) * 0.05;
        cursorCircle.scale.set(pulse, 1, pulse);
    }

    // 2) 휴면 상태 관리
    updateDormantStates(time);
}

/* ========================= 
 * 휴면 상태 업데이트
 * ========================= */
function updateDormantStates(time) {
    if (!_plants) return;

    const now = performance.now();
    const toRemove = [];

    for (const [uuid, state] of dormantState.entries()) {
        const elapsed = now - state.startTime;

        // 휴면 기간 만료 체크
        if (elapsed >= state.duration) {
            toRemove.push(uuid);
            continue;
        }

        // 휴면 상태 시각화 (재질 변경)
        const lsys = _plants.find((p) => p?.plantMesh?.uuid === uuid);
        if (lsys && lsys.plantMesh) {
            applyDormantVisual(lsys, elapsed, state.duration);
        }
    }

    // 만료된 휴면 상태 제거 및 원복
    for (const uuid of toRemove) {
        const state = dormantState.get(uuid);
        const lsys = _plants.find((p) => p?.plantMesh?.uuid === uuid);

        if (lsys && lsys.plantMesh && state.originalMaterial) {
            // 원래 재질로 복원
            lsys.plantMesh.material = state.originalMaterial;
            lsys.plantMesh.material.needsUpdate = true;
            console.log(`[Interaction] ⏰ 식물 ${uuid.slice(0, 8)}... 휴면 해제 (원복)`);
        }

        dormantState.delete(uuid);
    }
}

/* ========================= 
 * 휴면 상태 시각화
 * ========================= */
function applyDormantVisual(lsys, elapsed, duration) {
    if (!lsys.plantMesh || !lsys.plantMesh.material) return;

    const mat = lsys.plantMesh.material;
    const progress = elapsed / duration; // 0 ~ 1

    // 주황색으로 변화 (coil 색상)
    const dormantColor = new THREE.Color(0xff6b35); // 주황
    const originalEmissive = new THREE.Color(0x0f1419); // 원래 발광색

    // 발광색을 주황으로 변경 (점진적)
    mat.emissive.lerpColors(originalEmissive, dormantColor, Math.min(progress * 3, 1.0));
    mat.emissiveIntensity = 0.5 + Math.sin(elapsed * 0.003) * 0.2; // 펄스 효과

    mat.needsUpdate = true;
}

/* ========================= 
 * 디버그 정보
 * ========================= */
export function getInteractionState() {
    return {
        mouseWorld: mouseState.worldPosition.clone(),
        clickRadius: mouseState.clickRadius,
        dormantCount: dormantState.size,
        dormantPlants: Array.from(dormantState.keys()).map((uuid) => uuid.slice(0, 8)),
    };
}

/* ========================= 
 * 정리 (필요시)
 * ========================= */
export function disposeInteraction() {
    if (cursorCircle) {
        _scene.remove(cursorCircle);
        cursorCircle.geometry.dispose();
        cursorCircle.material.dispose();
        cursorCircle = null;
    }

    if (effectCircle) {
        _scene.remove(effectCircle);
        effectCircle.geometry.dispose();
        effectCircle.material.dispose();
        effectCircle = null;
    }

    dormantState.clear();
    console.log("[Interaction] 정리 완료");
}

