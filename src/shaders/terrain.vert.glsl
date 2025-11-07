// terrain.vert.glsl
precision highp float;

in vec3 position;
in vec2 uv;
out vec2 vUv;
out float vH;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat4 modelMatrix;

uniform sampler2D tHeight;   // R=height(0..1)
uniform float heightScale;   // 월드 스케일 높이
uniform float seaLevel;      // 0..1 정규화 높이 기준선

void main() {
  vUv = uv;
  float h = texture(tHeight, uv).r;   // 0..1
  vH = h;
  // 서버실 바닥 기준(바다=0) 맞춰 살짝 내리는 느낌: seaLevel을 기준으로 오프셋
  float y = (h - seaLevel) * heightScale;
  vec3 pos = vec3(position.x, position.y + y, position.z);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}


