// terrain.js
import * as THREE from "three";

async function loadText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}`);
  return res.text();
}

// 간단한 타일러블 해시 기반 value noise + fbm
function hash2(x, y) {
  let h = (x * 374761393 + y * 668265263) >>> 0;
  h = (h ^ (h >> 13)) * 1274126177 >>> 0;
  return (h ^ (h >> 16)) >>> 0;
}
function rand2(x, y) {
  return (hash2(x, y) & 0xffff) / 65535.0;
}
function valueNoise2d(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const r00 = rand2(xi, yi);
  const r10 = rand2(xi + 1, yi);
  const r01 = rand2(xi, yi + 1);
  const r11 = rand2(xi + 1, yi + 1);
  const sx = xf * xf * (3.0 - 2.0 * xf);
  const sy = yf * yf * (3.0 - 2.0 * yf);
  const nx0 = r00 * (1.0 - sx) + r10 * sx;
  const nx1 = r01 * (1.0 - sx) + r11 * sx;
  return nx0 * (1.0 - sy) + nx1 * sy;
}
function fbm2d(x, y, octaves = 5, lac = 2.0, gain = 0.5) {
  let a = 0.0, amp = 1.0, fx = x, fy = y;
  let norm = 0.0;
  for (let i = 0; i < octaves; i++) {
    a += valueNoise2d(fx, fy) * amp;
    norm += amp;
    fx *= lac; fy *= lac; amp *= gain;
  }
  return a / Math.max(1e-6, norm);
}

// helpers for CPU generation
function smoothstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

async function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

export async function createTerrain({
  width = 200,
  depth = 200,
  res = 256,
  heightScale = 20,
  seaLevel = 0.48,
  heightmapUrl = null,
  renderer = null,
  // 서버실 그리드 파라미터
  tiles = 14.0,
  aisleW = 0.06,
  rackJitterAmp = 0.15,   // 랙(셀)마다 높이 지터 증가 (0.06 → 0.15)
  crownAmp = 0.06,        // 랙 중앙 볼록함 증가 (0.02 → 0.06)
} = {}) {
  // GLSL 텍스트 로드(ESM ?raw 대신 fetch 사용 → MIME 오류 회피)
  const [vert, frag] = await Promise.all([
    loadText("./src/shaders/terrain.vert.glsl"),
    loadText("./src/shaders/terrain.frag.glsl"),
  ]);

  // height 데이터 준비(Float32Array 0..1)
  const N = res;
  const heights = new Float32Array(N * N);
  let tex; // THREE.Texture

  if (heightmapUrl) {
    try {
      const img = await loadImage(heightmapUrl);
      const c = document.createElement("canvas");
      c.width = N; c.height = N;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0, N, N);
      const data = ctx.getImageData(0, 0, N, N).data;
      for (let i = 0; i < N * N; i++) {
        heights[i] = data[i * 4] / 255.0;
      }
      tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.NoColorSpace; // height는 리니어 데이터
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.needsUpdate = true;
    } catch (e) {
      console.warn("[terrain] heightmap 로드 실패 → procedural 대체", e);
    }
  }

  if (!tex) {
    const c = document.createElement("canvas");
    c.width = N; c.height = N;
    const ctx = c.getContext("2d");
    const imgData = ctx.createImageData(N, N);
    // 서버실 느낌: 격자식 복도(낮음)와 랙(높음)으로 구성
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const u = x / N, v = y / N;
        // 그리드 셀 내부 좌표
        const cuv = u * tiles;
        const cvv = v * tiles;
        const cu = (cuv - Math.floor(cuv)) - 0.5;
        const cv = (cvv - Math.floor(cvv)) - 0.5;
        const d = Math.min(Math.abs(cu), Math.abs(cv));
        // 복도: d가 작을수록 복도에 가까움 → 낮게
        let aisle = 1.0 - smoothstep(aisleW, aisleW + 0.01, d);
        // 랙 내부는 높음, 복도는 낮음
        let h = 0.42 * (1.0 - (1.0 - aisle)) + 0.68 * (1.0 - aisle);
        // 셀의 번갈아 높이 변화(랙 높이 편차) - 증폭
        const cx = Math.floor(u * tiles);
        const cy = Math.floor(v * tiles);
        const parity = ((cx + cy) % 2);
        h += (parity ? 0.08 : -0.04); // 증가: 0.02/-0.01 → 0.08/-0.04
        // 랙마다 고유 지터(해시 기반): ±rackJitterAmp
        const r = (hash2(cx, cy) & 0xffff) / 65535.0; // 0..1
        h += (r - 0.5) * rackJitterAmp * 2.0; // 2배 증폭
        // 추가: 일부 랙은 매우 높게(타워형), 일부는 낮게(매립형)
        const r2 = (hash2(cx * 3, cy * 5) & 0xffff) / 65535.0;
        if (r2 > 0.85) {
          h += 0.12; // 15% 확률로 높은 타워 랙
        } else if (r2 < 0.10) {
          h -= 0.08; // 10% 확률로 낮은 매립 랙
        }
        // 랙 중앙 볼록(선반/랙 상단 형상 강조)
        const centerR = Math.sqrt(cu * cu + cv * cv); // 0..~0.7
        const crown = Math.max(0, 1.0 - smoothstep(0.15, 0.45, centerR));
        h += crown * crownAmp;
        // 미세 거칠기
        const detail = fbm2d(u * 24.0, v * 24.0, 2, 2.0, 0.5) * 0.03;
        h = Math.min(1.0, Math.max(0.0, h + detail));
        const i = (y * N + x);
        heights[i] = h;
        const g = Math.floor(h * 255);
        const idx = i * 4;
        imgData.data[idx + 0] = g;
        imgData.data[idx + 1] = g;
        imgData.data[idx + 2] = g;
        imgData.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);
    tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.NoColorSpace;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
  }

  // 지오메트리: Plane → XZ로 회전
  const geo = new THREE.PlaneGeometry(width, depth, N - 1, N - 1);
  geo.rotateX(-Math.PI * 0.5);

  const uniforms = {
    tHeight: { value: tex },
    heightScale: { value: heightScale },
    seaLevel: { value: seaLevel },
    gridTiles: { value: tiles },
    lineWidth: { value: 0.015 },
  };

  const mat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: vert,
    fragmentShader: frag,
    uniforms,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;

  // 샘플러: world(x,z) → uv, 높이/노멀
  function worldToUV(x, z) {
    const u = (x / width) + 0.5;
    const v = (z / depth) + 0.5;
    return { u: Math.min(1.0, Math.max(0.0, u)), v: Math.min(1.0, Math.max(0.0, v)) };
  }
  function sampleHeightUV(u, v) {
    const x = Math.min(N - 1, Math.max(0, Math.floor(u * (N - 1))));
    const y = Math.min(N - 1, Math.max(0, Math.floor(v * (N - 1))));
    return heights[y * N + x];
  }
  function heightAtXZ(x, z) {
    const { u, v } = worldToUV(x, z);
    return sampleHeightUV(u, v);
  }
  function normalAtXZ(x, z) {
    const eps = Math.min(width, depth) / N; // 한 픽셀 정도
    const hL = heightAtXZ(x - eps, z);
    const hR = heightAtXZ(x + eps, z);
    const hD = heightAtXZ(x, z - eps);
    const hU = heightAtXZ(x, z + eps);
    const sx = (hR - hL);
    const sz = (hU - hD);
    // 높이 스케일 반영
    const n = new THREE.Vector3(-sx * heightScale, 2.0, -sz * heightScale).normalize();
    return n;
  }

  return {
    mesh,
    heightmapTex: tex,
    uniforms,
    heightAtXZ,
    normalAtXZ,
    worldToUV,
  };
}


