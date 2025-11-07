// scene.js - Scene, Camera, Renderer, Lights 설정
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

export function createScene() {
  const scene = new THREE.Scene();
  
  const camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.1,
    2000
  );
  camera.position.set(90, 70, 90);
  camera.lookAt(0, 0, 0);
  
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setClearColor(0x0f1216, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  document.body.appendChild(renderer.domElement);
  
  return { scene, camera, renderer };
}

export function setupLights(scene) {
  // 서버실 느낌 라이트
  const hemi = new THREE.HemisphereLight(0xffffff, 0x222233, 0.8);
  scene.add(hemi);
  
  const dir = new THREE.DirectionalLight(0xb0c4de, 1.2);
  dir.position.set(60, 120, 40);
  dir.castShadow = true;
  scene.add(dir);
  
  return { hemi, dir };
}

export function setupControls(camera, domElement) {
  const controls = new OrbitControls(camera, domElement);
  return controls;
}

export function setupResize(camera, renderer) {
  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

