// ga.js - Genetic Algorithm for Boid Phenotypes in Server Garden
// - Genome 정의
// - Fitness 함수 (팔레트/패턴/사이즈/무브먼트)
// - Selection / Crossover / Mutation
// - Population 관리

/* =========================
 * 상수 정의 (세계관 기반)
 * ========================= */

// Palette (색) – 서버실 LED/금속 톤과 어울리는 좁은 달콤 지점
export const PALETTE_GOOD_HUE_MIN = 170.0; // 조금 더 시안/블루에 가깝게
export const PALETTE_GOOD_HUE_MAX = 210.0;
export const PALETTE_GOOD_VAL_MIN = 0.55; // 너무 어둡지 않게
export const PALETTE_GOOD_VAL_MAX = 0.8;

// Pattern (무늬) – Reaction-Diffusion 메타데이터 (좋은 범위도 살짝 좁게)
export const PATTERN_GOOD_SPOTCOUNT_MIN = 30;
export const PATTERN_GOOD_SPOTCOUNT_MAX = 70;
export const PATTERN_GOOD_SPOTSIZE_MIN = 4;
export const PATTERN_GOOD_SPOTSIZE_MAX = 8;

// Movement (움직임) – 속도/쇼오프 선호 범위 (중간값 중심으로)
export const MOVEMENT_GOOD_SPEED_MIN = 0.9;
export const MOVEMENT_GOOD_SPEED_MAX = 1.1;
export const MOVEMENT_GOOD_SHOWOFF_MIN = 0.35;
export const MOVEMENT_GOOD_SHOWOFF_MAX = 0.65;

// Size (몸집)
export const SIZE_GOOD_MIN = 0.8;
export const SIZE_GOOD_MAX = 1.4;

// RD 패턴 메타데이터 (A~E)
// - 시각적으로 명확히 다른 5종이라는 가정 하에,
//   역할/성향도 구분해서 GA가 서로 다른 niche 를 찾도록 한다.
export const RD_PATTERN_TABLE = [
    // patternId 0 → A : 느슨한 점무늬, 중간 복잡도, 부드러운 안정형
    { id: 0, name: "A", spotCount: 28, spotSize: 5, roughness: 0.25, type: "soft_spots" },
    // patternId 1 → B : 매우 조밀한 미세 점무늬, 노이즈 흡수 강한 타입
    { id: 1, name: "B", spotCount: 80, spotSize: 3, roughness: 0.7, type: "micro_spots" },
    // patternId 2 → C : 큰 덩어리 패턴, 묵직하고 느린 열 저장형
    { id: 2, name: "C", spotCount: 20, spotSize: 9, roughness: 0.45, type: "blobs" },
    // patternId 3 → D : 가는 줄무늬 위주, 방향성이 강하고 고속 이동에 유리
    { id: 3, name: "D", spotCount: 65, spotSize: 4, roughness: 0.8, type: "fine_stripes" },
    // patternId 4 → E : 점 + 줄무늬 혼합, 다목적 하이브리드
    { id: 4, name: "E", spotCount: 40, spotSize: 6, roughness: 0.55, type: "hybrid" },
];

// RD 텍스처 파일 경로 (boids.js에서 로딩용으로도 사용 가능)
export const RD_TEXTURE_PATHS = [
    "./assets/textures/rd_pattern.png", // patternId 0
    "./assets/textures/rd_pattern2.png", // patternId 1
    "./assets/textures/rd_pattern3.png", // patternId 2
    "./assets/textures/rd_pattern4.png", // patternId 3
    "./assets/textures/rd_pattern5.png", // patternId 4
];

/* =========================
 * 유틸리티
 * ========================= */

function clamp01(x) {
    return x < 0 ? 0 : x > 1 ? 1 : x;
}

function inRange(v, min, max) {
    return v >= min && v <= max;
}

function randFloat(min, max) {
    return min + Math.random() * (max - min);
}

function randInt(min, maxInclusive) {
    return Math.floor(min + Math.random() * (maxInclusive + 1 - min));
}

/* =========================
 * GeneticAlgorithm 클래스
 * ========================= */

export class GeneticAlgorithm {
    /**
     * @param {object} opts
     * @param {number} [opts.populationSize=40]
     * @param {number} [opts.survivalRate=0.4]
     * @param {number} [opts.mutationRate=0.15]
     * @param {number} [opts.crossoverRate=1.0]
     * @param {number[]} [opts.slotPatternIds] - 인덱스별 초기 patternId 고정 분포
     */
    constructor(opts = {}) {
        this.populationSize = opts.populationSize ?? 40;
        this.survivalRate = opts.survivalRate ?? 0.3;   // 상위 30%만 강하게 생존
        this.mutationRate = opts.mutationRate ?? 0.3;   // 변화량을 더 크게
        this.crossoverRate = opts.crossoverRate ?? 1.0;

        this.slotPatternIds =
            opts.slotPatternIds ?? this._createDefaultSlotPatternIds(this.populationSize);

        this.population = [];
        this.fitness = [];
        this.generation = 0;

        this.lastSortedIndices = [];
        this.lastSurvivors = [];
        this.lastDoomed = [];
    }

    _createDefaultSlotPatternIds(n) {
        // 5패턴 균등 분포: 0~4를 순환하며 할당
        const ids = new Array(n);
        for (let i = 0; i < n; i++) {
            ids[i] = i % 5;
        }
        return ids;
    }

    /* ========== Genome 생성 ========== */

    /**
     * 단일 Genome 랜덤 생성 (초기 분포 규칙 반영)
     * @param {number} index - 개체 인덱스 (slotPatternIds용)
     */
    createRandomGenome(index = 0) {
        const patternId = this.slotPatternIds[index] ?? randInt(0, 4);

        const g = {
            // 처음에는 비교적 넓지만 서버 톤 근처에서 시작
            hue: randFloat(150, 230),
            value: randFloat(0.3, 0.95),
            patternId,
            // 크기/속도/쇼오프는 제법 넓은 범위로 시작 (세대가 지나며 정돈됨)
            bodyScale: randFloat(0.5, 2.0),
            baseSpeed: randFloat(0.5, 1.8),
            showOff: randFloat(0.0, 1.2),
            genId: 0, // 0세대에서 시작
        };
        return g;
    }

    /**
     * 초기 개체군 생성
     */
    initPopulation() {
        this.population = [];
        for (let i = 0; i < this.populationSize; i++) {
            this.population.push(this.createRandomGenome(i));
        }
        this.fitness = new Array(this.populationSize).fill(0);
        this.generation = 0;
        this.lastSortedIndices = [];
        this.lastSurvivors = [];
        this.lastDoomed = [];
        return this.population;
    }

    getPopulation() {
        return this.population;
    }

    /* ========== Score 함수 ========== */

    _paletteScore(g) {
        const h = g.hue;
        const v = g.value;
        let s = 0;
        if (inRange(h, PALETTE_GOOD_HUE_MIN, PALETTE_GOOD_HUE_MAX)) s += 0.5;
        if (inRange(v, PALETTE_GOOD_VAL_MIN, PALETTE_GOOD_VAL_MAX)) s += 0.5;
        return s; // 0 / 0.5 / 1
    }

    _patternScore(g) {
        const meta = RD_PATTERN_TABLE[g.patternId] ?? RD_PATTERN_TABLE[0];
        const cnt = meta.spotCount;
        const sz = meta.spotSize;
        let s = 0;
        if (inRange(cnt, PATTERN_GOOD_SPOTCOUNT_MIN, PATTERN_GOOD_SPOTCOUNT_MAX)) s += 0.5;
        if (inRange(sz, PATTERN_GOOD_SPOTSIZE_MIN, PATTERN_GOOD_SPOTSIZE_MAX)) s += 0.5;
        return s; // 0 / 0.5 / 1
    }

    _sizeScore(g) {
        const b = g.bodyScale;
        return inRange(b, SIZE_GOOD_MIN, SIZE_GOOD_MAX) ? 1.0 : 0.0;
    }

    _movementScore(g) {
        const sp = g.baseSpeed;
        const sh = g.showOff;
        let s = 0;
        if (inRange(sp, MOVEMENT_GOOD_SPEED_MIN, MOVEMENT_GOOD_SPEED_MAX)) s += 0.5;
        if (inRange(sh, MOVEMENT_GOOD_SHOWOFF_MIN, MOVEMENT_GOOD_SHOWOFF_MAX)) s += 0.5;
        return s; // 0 / 0.5 / 1
    }

    /**
     * 패턴-움직임 시너지 보너스
     * - 줄무늬(D)는 더 빠른 개체에 + 보너스
     * - 큰 덩어리(C)는 약간 느린/무거운 개체에 + 보너스
     * - 하이브리드(E)는 중간 속도·쇼오프에서 소량 보너스
     */
    _synergyBonus(g) {
        const meta = RD_PATTERN_TABLE[g.patternId] ?? RD_PATTERN_TABLE[0];
        const sp = g.baseSpeed;
        const sh = g.showOff;
        let bonus = 0;

        if (meta.type === "fine_stripes") {
            // 고속 스트라이프 → 빠를수록 약간 유리
            if (sp > 1.1) bonus += 0.15;
            if (sp > 1.2) bonus += 0.05;
        } else if (meta.type === "blobs") {
            // 큰 덩어리는 느리고 안정적인 움직임 선호
            if (sp < 0.9) bonus += 0.15;
            if (sh < 0.4) bonus += 0.05;
        } else if (meta.type === "hybrid") {
            // 하이브리드는 중간대에서 소량 보너스
            if (inRange(sp, 0.9, 1.1) && inRange(sh, 0.4, 0.7)) bonus += 0.1;
        } else if (meta.type === "micro_spots") {
            // 미세 점무늬는 살짝 높은 쇼오프에서 빛난다
            if (sh > 0.6) bonus += 0.1;
        }

        return bonus;
    }

    /**
     * 단일 Genome의 최종 fitness 계산
     */
    _fitnessOf(g) {
        const pCol = this._paletteScore(g);
        const pPat = this._patternScore(g);
        const pSize = this._sizeScore(g);
        const pMove = this._movementScore(g);
        const synergy = this._synergyBonus(g);

        // 가중 평균 + 시너지 보너스
        const wCol = 0.2;
        const wPat = 0.35;
        const wSize = 0.2;
        const wMove = 0.25;
        const base =
            pCol * wCol +
            pPat * wPat +
            pSize * wSize +
            pMove * wMove;
        const denom = wCol + wPat + wSize + wMove;
        const raw = base / denom + synergy;
        return clamp01(raw);
    }

    /* ========== Evaluation & Selection ========== */

    /**
     * 현재 population 전체 평가
     * - fitness 배열 갱신
     * - lastSortedIndices / lastSurvivors / lastDoomed 기록
     */
    evaluatePopulation() {
        const N = this.populationSize;
        if (!this.population || this.population.length !== N) {
            throw new Error("[GA] population이 초기화되지 않았습니다. initPopulation()을 먼저 호출하세요.");
        }

        this.fitness = new Array(N);
        for (let i = 0; i < N; i++) {
            this.fitness[i] = this._fitnessOf(this.population[i]);
        }

        // fitness 내림차순 정렬 인덱스
        const indices = Array.from({ length: N }, (_, i) => i);
        indices.sort((a, b) => this.fitness[b] - this.fitness[a]);
        this.lastSortedIndices = indices;

        const survivorCount = Math.max(1, Math.floor(N * this.survivalRate));
        const survivors = indices.slice(0, survivorCount);
        const doomed = indices.slice(survivorCount);
        this.lastSurvivors = survivors;
        this.lastDoomed = doomed;

        return {
            fitness: this.fitness,
            sortedIndices: indices,
            survivors,
            doomed,
        };
    }

    getLastEvaluationInfo() {
        return {
            fitness: this.fitness,
            sortedIndices: this.lastSortedIndices,
            survivors: this.lastSurvivors,
            doomed: this.lastDoomed,
        };
    }

    /**
     * Tournament selection (작은 크기)
     * - 기본적으로 상위 개체 쪽에서 더 자주 뽑히게 한다.
     */
    _selectParentIndex() {
        const N = this.populationSize;
        const k = 3; // 토너먼트 크기
        let bestIdx = null;
        let bestFit = -Infinity;
        for (let i = 0; i < k; i++) {
            const idx = randInt(0, N - 1);
            const f = this.fitness[idx];
            if (f > bestFit) {
                bestFit = f;
                bestIdx = idx;
            }
        }
        return bestIdx ?? 0;
    }

    /* ========== Crossover & Mutation ========== */

    _cloneGenome(g) {
        return {
            hue: g.hue,
            value: g.value,
            patternId: g.patternId,
            bodyScale: g.bodyScale,
            baseSpeed: g.baseSpeed,
            showOff: g.showOff,
            genId: g.genId,
        };
    }

    /**
     * 두 부모로부터 자식 1개 생성 (균등/평균 혼합)
     */
    _crossover(gA, gB) {
        if (Math.random() > this.crossoverRate) {
            // 교차 안 할 때는 아무 부모나 복제
            return this._cloneGenome(Math.random() < 0.5 ? gA : gB);
        }

        const child = {
            // 연속값은 평균 + 약간 노이즈
            hue: (gA.hue + gB.hue) * 0.5 + randFloat(-10, 10),
            value: (gA.value + gB.value) * 0.5 + randFloat(-0.05, 0.05),
            // patternId는 부모 중 하나 채택
            patternId: Math.random() < 0.5 ? gA.patternId : gB.patternId,
            bodyScale: (gA.bodyScale + gB.bodyScale) * 0.5 + randFloat(-0.1, 0.1),
            baseSpeed: (gA.baseSpeed + gB.baseSpeed) * 0.5 + randFloat(-0.05, 0.05),
            showOff: (gA.showOff + gB.showOff) * 0.5 + randFloat(-0.05, 0.05),
            genId: this.generation + 1, // 자식은 다음 세대에 속함
        };
        return child;
    }

    _mutateValue(v, min, max, amount) {
        const span = max - min;
        const delta = (Math.random() * 2 - 1) * span * amount;
        const out = v + delta;
        return out < min ? min : out > max ? max : out;
    }

    /**
     * 단일 Genome 돌연변이
     */
    _mutate(genome) {
        // 팔레트는 비교적 안정적으로, 동작/크기는 더 과감하게 변이
        if (Math.random() < this.mutationRate * 0.7) {
            genome.hue = this._mutateValue(genome.hue, 0, 360, 0.25);
        }
        if (Math.random() < this.mutationRate * 0.7) {
            genome.value = this._mutateValue(genome.value, 0, 1, 0.3);
        }
        if (Math.random() < this.mutationRate * 0.8) {
            genome.patternId = randInt(0, RD_PATTERN_TABLE.length - 1);
        }
        if (Math.random() < this.mutationRate) {
            genome.bodyScale = this._mutateValue(genome.bodyScale, 0.5, 2.0, 0.4);
        }
        if (Math.random() < this.mutationRate) {
            genome.baseSpeed = this._mutateValue(genome.baseSpeed, 0.5, 1.8, 0.4);
        }
        if (Math.random() < this.mutationRate) {
            genome.showOff = this._mutateValue(genome.showOff, 0.0, 1.2, 0.5);
        }
        return genome;
    }

    /* ========== 세대 전환 ========== */

    /**
     * 마지막 evaluatePopulation() 결과(survivors/doomed)를 사용해
     * 다음 세대를 생성한다.
     * - 상위 survivals는 그대로 복제(엘리트 보존)
     * - doomed 자리는 부모들에서 crossover+mutation으로 채운다.
     */
    nextGeneration() {
        if (!this.lastSortedIndices.length) {
            // 아직 평가되지 않았다면 내부적으로 한 번 평가
            this.evaluatePopulation();
        }

        const N = this.populationSize;
        const survivors = this.lastSurvivors;
        const doomed = this.lastDoomed;

        const newPop = new Array(N);

        // 1) 엘리트 보존: survivors 그대로 복제
        for (const idx of survivors) {
            newPop[idx] = this._cloneGenome(this.population[idx]);
        }

        // 2) doomed 슬롯 채우기
        for (const idx of doomed) {
            // 부모는 전체 population 기준 토너먼트로 고른다.
            const pA = this.population[this._selectParentIndex()];
            const pB = this.population[this._selectParentIndex()];
            let child = this._crossover(pA, pB);
            child = this._mutate(child);
            child.genId = this.generation + 1; // 새로 태어난 개체의 세대 표시
            newPop[idx] = child;
        }

        this.population = newPop;
        this.generation += 1;

        // 다음 evaluation을 위해 캐시 리셋
        this.fitness = new Array(N).fill(0);
        this.lastSortedIndices = [];
        this.lastSurvivors = [];
        this.lastDoomed = [];

        return this.population;
    }
}


