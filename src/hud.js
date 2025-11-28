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
      whiteSpace: "pre", // 줄바꿈 유지
    });
    document.body.appendChild(hud);
  }
  
  let frames = 0;
  let lastTime = performance.now();
  let accMs = 0;
  
  return {
    element: hud,
    /**
     * @param {number} frameTime - 이번 프레임 렌더링 시간(ms)
     * @param {object|null} gaStats - GA 요약 정보 (generation, patternCounts 등)
     */
    update: (frameTime, gaStats = null) => {
      frames++;
      accMs += frameTime;
      const now = performance.now();
      
      if (now - lastTime >= 1000) {
        const fps = Math.round((frames * 1000) / (now - lastTime));
        const avg = (accMs / frames).toFixed(1);
        let text = `FPS: ${fps} | Avg: ${avg} ms`;

        if (gaStats) {
          const gen = gaStats.generation ?? 0;
          const pc = gaStats.patternCounts || [0, 0, 0, 0, 0];
          const avgScale = gaStats.avgScale?.toFixed(2) ?? "–";
          const avgSpeed = gaStats.avgSpeed?.toFixed(2) ?? "–";
          const avgShow = gaStats.avgShow?.toFixed(2) ?? "–";
          const bestFit =
            typeof gaStats.bestFitness === "number"
              ? gaStats.bestFitness.toFixed(2)
              : "–";

          text += `\nGen ${gen} | P0:${pc[0] ?? 0} P1:${pc[1] ?? 0} P2:${pc[2] ?? 0} P3:${pc[3] ?? 0} P4:${pc[4] ?? 0}`;
          text += `\n⌀scale:${avgScale} ⌀spd:${avgSpeed} ⌀show:${avgShow} | best:${bestFit}`;
        }

        hud.textContent = text;
        frames = 0;
        accMs = 0;
        lastTime = now;
      }
    },
  };
}

