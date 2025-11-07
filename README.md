# Generative Design 2025 - Server Garden

서버실 환경에서 자라나는 전선 식물 시뮬레이션

## 📁 프로젝트 구조

```
gd9-plant/
├── index.html              # 메인 HTML (main.js 로드)
├── README.md              # 프로젝트 문서 (이 파일)
├── assets/
│   ├── models/
│   │   └── Datacolla_crypta.glb   # Boids 모델
│   └── textures/
│       └── RD.png         # (선택) Reaction-Diffusion 텍스처
└── src/
    ├── main.js            # 🎯 메인 진입점 (통합 관리)
    ├── scene.js           # Scene, Camera, Renderer, Lights
    ├── hud.js             # FPS/성능 HUD
    ├── terrain.js         # 지형 생성 (서버 랙 구조)
    ├── boids.js           # Boids 시뮬레이션
    ├── plants.js          # L-System 식물 관리
    ├── lsystem.js         # L-System 코어 엔진
    └── shaders/
        ├── terrain.vert.glsl
        ├── terrain.frag.glsl
        ├── rd_init.frag.glsl
        ├── rd_update.frag.glsl
        └── rd_display.frag.glsl
```

## 🎮 모듈 구조

### 1. **main.js** - 메인 컨트롤러
- 애플리케이션 전체 초기화 및 통합
- 애니메이션 루프 관리
- 모듈 간 조율

### 2. **scene.js** - 씬 설정
- Three.js Scene, Camera, Renderer 생성
- 라이트 설정 (HemisphereLight, DirectionalLight)
- OrbitControls 설정
- 리사이즈 핸들러

### 3. **hud.js** - HUD 표시
- FPS 카운터
- 프레임 시간 측정

### 4. **terrain.js** - 지형 생성
- Procedural heightmap (서버 랙 구조)
- 복도/랙 패턴 생성
- 높이맵 기반 지형 메쉬
- 표면 샘플링 함수 (`heightAtXZ`, `normalAtXZ`)

### 5. **boids.js** - Boids 시스템
- 군집 행동 알고리즘 (Alignment, Cohesion, Separation)
- 지형 경계 제한
- 표면 추종 로직
- InstancedMesh 기반 렌더링

### 6. **plants.js** - 식물 관리
- 복도 위치 자동 탐지
- 여러 L-System 식물 생성
- 환경 반응 애니메이션 (전하 구슬)
- 키보드 컨트롤

### 7. **lsystem.js** - L-System 엔진
- Gray-Scott Reaction-Diffusion 규칙
- Turtle Graphics 인터프리터
- 그물 구조 (Merge 로직)
- 환경 자극 시스템

## 🎮 키보드 컨트롤

### 식물 제어
| 키 | 기능 |
|---|---|
| `Space` | 전체 식물 재생/정지 |
| `[` / `]` | 세대 수 감소/증가 (재생성) |
| `J` / `K` | 분기 각도 감소/증가 |
| `N` / `M` | 투명도 감쇠 감소/증가 |

### 환경 제어 (전하 구슬 색상 변화)
| 키 | 기능 | 효과 |
|---|---|---|
| `H` / `G` | 열 증가/감소 | 🔥 빨강 ↔️ ❄️ 시안 |
| `E` / `Q` | 전류 증가/감소 | ⚡ 발광 강도 + 초록 |
| `I` / `U` | 정적 증가/감소 | 💤 전하 구슬 생성 확률 |

## 🚀 실행 방법

```bash
# 로컬 서버 실행 (Python 3)
python3 -m http.server 8080

# 브라우저에서 열기
open http://localhost:8080
```

## 🎨 주요 기능

### 1. **서버실 지형**
- 격자식 랙/복도 구조
- 다양한 높이 변화 (타워/일반/매립 랙)
- Procedural 생성

### 2. **L-System 식물**
- 15개 위치에서 독립적 성장
- 열/전류 환경 반응
- 전하 구슬 (실시간 색상/발광 변화)
- 그물 구조 (가지 merge)

### 3. **Boids 군집**
- 120개 개체
- 지형 표면 추종
- 경계 제한 (bounce)
- 자연스러운 군집 행동

### 4. **실시간 환경 반응**
- 열 수준 → 전하 구슬 색상 (시안 → 빨강)
- 전류 잡음 → 발광 강도 + 초록 강화
- 정적 사이클 → 전하 구슬 생성

## 📊 성능 최적화

- **InstancedMesh**: Boids 120개 효율적 렌더링
- **BufferGeometry**: 모든 지오메트리 최적화
- **DynamicDrawUsage**: 매트릭스 갱신 최적화
- **Object pooling**: 임시 객체 재사용

## 🔧 디버깅

콘솔에서 애플리케이션 상태 접근:
```javascript
window.appState.scene      // Three.js Scene
window.appState.terrain    // 지형 객체
window.appState.boidsReady // Boids 준비 상태
window.THREE               // Three.js 라이브러리
```

## 📝 라이선스

MIT License

## 👨‍💻 작성자

Generative Design 2025 - Server Garden Project

