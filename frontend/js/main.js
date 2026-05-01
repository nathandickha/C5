// js/main.js
// Keep the first page fast: render the starter options immediately, then load
// the heavier Three.js editor only after a pool preset is selected.

const STARTER_POOL_PRESETS = [
  {
    id: "rectangle-classic",
    title: "Rectangle Pool",
    description: "Clean rectangular starter pool with entry steps.",
    preview: "rectangle",
    params: { shape: "rectangular", length: 8, width: 4, shallow: 1.2, deep: 2.0, shallowFlat: 2, deepFlat: 2, stepCount: 3, stepDepth: 0.2 },
    spa: null
  },
  {
    id: "rectangle-square-spa",
    title: "Rectangle + Square Spa",
    description: "Rectangle pool with a square spa ready to reposition.",
    preview: "rectangle",
    params: { shape: "rectangular", length: 9, width: 4.5, shallow: 1.2, deep: 2.2, shallowFlat: 2, deepFlat: 2, stepCount: 3, stepDepth: 0.2 },
    spa: { shape: "square", width: 2.0, length: 2.0, topHeight: 0 }
  },
  {
    id: "rectangle-circular-spa",
    title: "Rectangle + Circular Spa",
    description: "Rectangle pool with a circular spa preset.",
    preview: "rectangle",
    params: { shape: "rectangular", length: 9, width: 4.5, shallow: 1.2, deep: 2.2, shallowFlat: 2, deepFlat: 2, stepCount: 3, stepDepth: 0.2 },
    spa: { shape: "circular", width: 2.0, length: 2.0, topHeight: 0 }
  },
  {
    id: "l-shape",
    title: "L-Shape Pool",
    description: "L-shape starter using the notch length and width controls.",
    preview: "lshape",
    params: { shape: "L", length: 10, width: 5.5, shallow: 1.2, deep: 2.4, shallowFlat: 2, deepFlat: 2, stepCount: 3, stepDepth: 0.2, notchLengthX: 0.4, notchWidthY: 0.45 },
    spa: null
  },
  {
    id: "l-shape-spa",
    title: "L-Shape + Spa",
    description: "L-shape pool with a square spa preset.",
    preview: "lshape",
    params: { shape: "L", length: 10, width: 5.5, shallow: 1.2, deep: 2.4, shallowFlat: 2, deepFlat: 2, stepCount: 3, stepDepth: 0.2, notchLengthX: 0.4, notchWidthY: 0.45 },
    spa: { shape: "square", width: 2.0, length: 2.0, topHeight: 0 }
  },
  {
    id: "oval",
    title: "Oval Pool",
    description: "Soft oval pool starter for rounded designs.",
    preview: "oval",
    params: { shape: "oval", length: 8, width: 4, shallow: 1.2, deep: 2.0, shallowFlat: 2, deepFlat: 2, stepCount: 3, stepDepth: 0.2 },
    spa: null
  },
  {
    id: "kidney",
    title: "Kidney Pool",
    description: "Kidney-shaped starter with editable kidney settings.",
    preview: "oval",
    params: { shape: "kidney", length: 9, width: 4.8, shallow: 1.2, deep: 2.2, shallowFlat: 2, deepFlat: 2, stepCount: 3, stepDepth: 0.2, kidneyLeftRadius: 2.0, kidneyRightRadius: 3.0, kidneyOffset: 1.0 },
    spa: null
  },
  {
    id: "lap-pool",
    title: "Lap Pool",
    description: "Long narrow pool preset for lap-style layouts.",
    preview: "lap",
    params: { shape: "rectangular", length: 14, width: 3, shallow: 1.2, deep: 1.8, shallowFlat: 3, deepFlat: 2, stepCount: 3, stepDepth: 0.2 },
    spa: null
  },
  {
    id: "plunge-pool",
    title: "Plunge Pool",
    description: "Compact starter pool for small-space concepts.",
    preview: "plunge",
    params: { shape: "rectangular", length: 5, width: 3, shallow: 1.2, deep: 1.6, shallowFlat: 1.5, deepFlat: 1, stepCount: 2, stepDepth: 0.2 },
    spa: null
  }
];

let appBootPromise = null;

function setStarterBusy(card, busy) {
  const allCards = document.querySelectorAll(".starter-card");
  allCards.forEach((item) => {
    item.disabled = busy;
    item.classList.toggle("is-disabled", busy && item !== card);
  });

  if (!card) return;
  card.classList.toggle("is-loading", busy);
  const action = card.querySelector(".starter-card-action");
  if (action) action.textContent = busy ? "Loading 3D Editor…" : "Start Design";
}

function setupStarterPresetScreen() {
  const overlay = document.getElementById("starterPresetOverlay");
  const grid = document.getElementById("starterPresetGrid");
  if (!overlay || !grid || grid.dataset.initialized === "true") return;

  grid.dataset.initialized = "true";
  grid.innerHTML = "";

  STARTER_POOL_PRESETS.forEach((preset) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "starter-card";
    card.dataset.presetId = preset.id;
    card.dataset.preview = preset.preview || "rectangle";
    card.dataset.spa = preset.spa ? "true" : "false";
    if (preset.spa?.shape) card.dataset.spaShape = preset.spa.shape;
    card.innerHTML = `
      <div class="starter-preview" aria-hidden="true"></div>
      <div class="starter-card-body">
        <h2 class="starter-card-title">${preset.title}</h2>
        <p class="starter-card-desc">${preset.description}</p>
        <span class="starter-card-action">Start Design</span>
      </div>
    `;

    card.addEventListener("click", async () => {
      if (appBootPromise) return;
      setStarterBusy(card, true);
      try {
        appBootPromise = import("./app/PoolApp.js").then(async ({ PoolApp }) => {
          const app = new PoolApp();
          window.poolApp = app;
          await app.start({ starterPreset: preset });
          overlay.classList.add("hidden");
          return app;
        });
        await appBootPromise;
      } catch (err) {
        console.error("[PoolApp] Failed to start 3D editor", err);
        appBootPromise = null;
        setStarterBusy(card, false);
        alert("The 3D editor failed to load. Check the console for details.");
      }
    });

    grid.appendChild(card);
  });
}

setupStarterPresetScreen();
