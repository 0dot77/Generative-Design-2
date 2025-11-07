// hud.js - HUD/FPS 표시
export function createHUD() {
  let hud = document.getElementById("fps");
  if (!hud) {
    hud = document.createElement("div");
    Object.assign(hud.style, {
      position: "fixed",
      left: "10px",
      top: "10px",
      padding: "6px 10px",
      background: "rgba(0,0,0,0.55)",
      color: "#9ad",
      fontFamily: "monospace",
      fontSize: "12px",
      borderRadius: "6px",
      zIndex: 9999,
      pointerEvents: "none",
    });
    document.body.appendChild(hud);
  }
  
  let frames = 0;
  let lastTime = performance.now();
  let accMs = 0;
  
  return {
    element: hud,
    update: (frameTime) => {
      frames++;
      accMs += frameTime;
      const now = performance.now();
      
      if (now - lastTime >= 1000) {
        const fps = Math.round((frames * 1000) / (now - lastTime));
        const avg = (accMs / frames).toFixed(1);
        hud.textContent = `FPS: ${fps} | Avg: ${avg} ms`;
        frames = 0;
        accMs = 0;
        lastTime = now;
      }
    },
  };
}

