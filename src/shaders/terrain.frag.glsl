// terrain.frag.glsl
precision highp float;

in vec2 vUv;
in float vH;          // 0..1
out vec4 outColor;

uniform float seaLevel;  // 0..1
uniform float gridTiles; // 그리드 갯수(타일 수)
uniform float lineWidth; // 그리드 라인 폭(0..0.1 권장)

// 서버실 톤 팔레트
const vec3 ASPHALT = vec3(0.06, 0.07, 0.09);    // 바닥
const vec3 CYAN_EM = vec3(0.05, 0.75, 0.95);    // 라인(차가운 사이언)
const vec3 METAL_LO = vec3(0.16, 0.18, 0.22);   // 낮은 금속
const vec3 METAL_HI = vec3(0.62, 0.70, 0.78);   // 높은 금속

// 계단형(하드) 톤 매핑: 높이를 몇 단계로 양자화
float quantize(float h, float levels) {
  return floor(h * levels) / levels;
}

void main() {
  // 서버실: seaLevel 아래를 바닥(통로), 위를 랙(금속)으로 해석
  bool isFloor = (vH < seaLevel);

  // 랙은 금속 그라디언트 + 높이 양자화로 하드한 느낌
  float qh = quantize(vH, 6.0);
  vec3 rackCol = mix(METAL_LO, METAL_HI, smoothstep(seaLevel, 1.0, qh));

  // 바닥은 어두운 아스팔트 계열
  vec3 floorCol = ASPHALT;

  // 그리드 라인(바닥 페인트) - vUv 기준 타일 라인 강조
  vec2 cell = fract(vUv * gridTiles) - 0.5;
  float d = min(abs(cell.x), abs(cell.y));
  float line = 1.0 - smoothstep(lineWidth, lineWidth + 0.003, d);
  // 랙 내부에서도 약하게 유지하여 전체가 서버실 톤으로 보이게
  float lineBoost = isFloor ? 1.0 : 0.25;

  vec3 base = isFloor ? floorCol : rackCol;
  vec3 col = mix(base, CYAN_EM, clamp(line * lineBoost, 0.0, 1.0));
  outColor = vec4(col, 1.0);
}


