import * as THREE from "https://esm.sh/three@0.158.0";
import { spas } from "../pool/spa.js";

const TILE_SURFACE_SETTINGS = {
  floor: {
    roughness: 0.46,
    normalScale: 0.48,
    displacementScale: 0.0016,
    envMapIntensity: 0.72,
    clearcoat: 0.14,
    clearcoatRoughness: 0.42
  },
  wall: {
    roughness: 0.4,
    normalScale: 0.58,
    displacementScale: 0.0,
    envMapIntensity: 0.82,
    clearcoat: 0.22,
    clearcoatRoughness: 0.36
  },
  step: {
    roughness: 0.44,
    normalScale: 0.52,
    displacementScale: 0.0008,
    envMapIntensity: 0.76,
    clearcoat: 0.16,
    clearcoatRoughness: 0.4
  },
  spa: {
    roughness: 0.4,
    normalScale: 0.56,
    displacementScale: 0.0,
    envMapIntensity: 0.82,
    clearcoat: 0.22,
    clearcoatRoughness: 0.36
  },
  default: {
    roughness: 0.45,
    normalScale: 0.5,
    displacementScale: 0.0,
    envMapIntensity: 0.76,
    clearcoat: 0.16,
    clearcoatRoughness: 0.4
  }
};

const TILE_UV_STAGE2_PROFILES = {
  floor: { repeat: 0.72, groutBoost: 1.0 },
  wall: { repeat: 0.74, groutBoost: 1.08 },
  step: { repeat: 0.78, groutBoost: 1.02 },
  spa: { repeat: 0.74, groutBoost: 1.08 },
  default: { repeat: 0.75, groutBoost: 1.0 }
};

const TILE_SOURCE_GRID = 6;
const TILE_GROUT_WIDTH = 0.026;

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function seededTileVariation(ix, iy, seed = 0) {
  const n = Math.sin((ix * 127.1 + iy * 311.7 + seed * 43.3)) * 43758.5453;
  return n - Math.floor(n);
}

function cloneTextureForSurface(tex, profile) {
  if (!tex) return null;
  const cloned = tex.clone();
  const repeat = Number.isFinite(profile?.repeat) ? profile.repeat : 1;
  cloned.wrapS = cloned.wrapT = THREE.RepeatWrapping;
  cloned.repeat.set(repeat, repeat);
  cloned.needsUpdate = true;
  return cloned;
}

function createStage2BaseColorTexture(sourceTex, tileKey = "tile") {
  const image = sourceTex?.image;
  const width = image?.naturalWidth || image?.videoWidth || image?.width || 0;
  const height = image?.naturalHeight || image?.videoHeight || image?.height || 0;
  if (!image || !width || !height || typeof document === "undefined") return sourceTex;

  try {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return sourceTex;

    ctx.drawImage(image, 0, 0, width, height);
    const img = ctx.getImageData(0, 0, width, height);
    const data = img.data;
    const seed = String(tileKey).split("").reduce((sum, ch) => sum + ch.charCodeAt(0), 0);

    // Work out whether the selected tile is a light tile set.
    // The previous Stage 2 pass treated most low-saturation/light pixels as grout,
    // which made the white tile render as a flat grey sheet. This samples the
    // texture first, then only draws grout on the actual grid lines.
    let lumaSum = 0;
    let sampleCount = 0;
    const stride = Math.max(1, Math.floor((width * height) / 6000));
    for (let i = 0; i < data.length; i += 4 * stride) {
      lumaSum += (data[i] / 255) * 0.2126 + (data[i + 1] / 255) * 0.7152 + (data[i + 2] / 255) * 0.0722;
      sampleCount++;
    }
    const averageLuma = sampleCount ? lumaSum / sampleCount : 0.5;
    const isLightTile = averageLuma > 0.55;
    const groutValue = isLightTile ? 0.42 : 0.82;
    const groutMix = isLightTile ? 0.72 : 0.58;
    const variationStrength = isLightTile ? 0.026 : 0.075;
    const microStrength = isLightTile ? 0.008 : 0.016;
    const contrast = isLightTile ? 1.018 : 1.04;

    for (let y = 0; y < height; y++) {
      const gy = (y / height) * TILE_SOURCE_GRID;
      const fy = gy - Math.floor(gy);
      const iy = Math.floor(gy);
      const horizontalDist = Math.min(fy, 1 - fy);
      const nearHorizontalGrout = horizontalDist < TILE_GROUT_WIDTH;

      for (let x = 0; x < width; x++) {
        const gx = (x / width) * TILE_SOURCE_GRID;
        const fx = gx - Math.floor(gx);
        const ix = Math.floor(gx);
        const verticalDist = Math.min(fx, 1 - fx);
        const nearVerticalGrout = verticalDist < TILE_GROUT_WIDTH;
        const idx = (y * width + x) * 4;

        let r = data[idx] / 255;
        let g = data[idx + 1] / 255;
        let b = data[idx + 2] / 255;

        if (nearVerticalGrout || nearHorizontalGrout) {
          const lineStrength = Math.max(
            nearVerticalGrout ? 1 - verticalDist / TILE_GROUT_WIDTH : 0,
            nearHorizontalGrout ? 1 - horizontalDist / TILE_GROUT_WIDTH : 0
          );
          const mix = groutMix * Math.pow(lineStrength, 0.72);
          r = r * (1 - mix) + groutValue * mix;
          g = g * (1 - mix) + groutValue * mix;
          b = b * (1 - mix) + groutValue * mix;
        } else {
          const variation = (seededTileVariation(ix, iy, seed) - 0.5) * variationStrength;
          const micro = (seededTileVariation(x >> 4, y >> 4, seed + 7) - 0.5) * microStrength;
          r = clamp01((r - 0.5) * contrast + 0.5 + variation + micro);
          g = clamp01((g - 0.5) * contrast + 0.5 + variation + micro);
          b = clamp01((b - 0.5) * contrast + 0.5 + variation + micro);
        }

        data[idx] = Math.round(clamp01(r) * 255);
        data[idx + 1] = Math.round(clamp01(g) * 255);
        data[idx + 2] = Math.round(clamp01(b) * 255);
      }
    }

    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = sourceTex.anisotropy || 12;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.userData = { ...(sourceTex.userData || {}), isStage2EnhancedTileBaseColor: true };
    return tex;
  } catch (err) {
    console.warn("Stage 2 tile enhancement skipped for", tileKey, err);
    return sourceTex;
  }
}


/**
 * PBRManager
 * Uses geometry UVs that are already meter-scaled.
 * No UV scaling here — avoids cross-mesh texture bleed.
 */
export class PBRManager {
  constructor(poolParamsRef, tileSize, causticsSystem) {
    this.poolParamsRef = poolParamsRef;
    this.tileSize = tileSize;
    this.caustics = causticsSystem;

    this.loader = new THREE.TextureLoader();
    this.tileLibrary = {};
    this.currentTileKey = "blue";
    this.poolGroup = null;
  }

  setPoolGroup(group) {
    this.poolGroup = group;
  }

  updatePoolParamsRef(ref) {
    this.poolParamsRef = ref;
  }

  async initButtons(initialPoolGroup) {
    this.poolGroup = initialPoolGroup;

    const buttons = Array.from(document.querySelectorAll(".tile-btn"));
    buttons.forEach((btn) => {
      btn.addEventListener("click", async () => {
        this.currentTileKey = btn.dataset.tile;
        buttons.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        await this.applyCurrentToGroup();
      });
    });

    await this.applyCurrentToGroup();
  }

  loadTexture(path, isColor = false) {
    return new Promise((resolve) => {
      if (!path) return resolve(null);

      this.loader.load(
        path,
        (tex) => {
          tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
          tex.repeat.set(1, 1);
          tex.anisotropy = 12;
          tex.generateMipmaps = true;
          tex.minFilter = THREE.LinearMipmapLinearFilter;
          tex.magFilter = THREE.LinearFilter;
          tex.colorSpace = isColor
            ? THREE.SRGBColorSpace
            : THREE.NoColorSpace;
          resolve(tex);
        },
        undefined,
        (err) => {
          console.warn("Failed to load tile texture:", path, err);
          resolve(null);
        }
      );
    });
  }

  tileBaseUrl(tileKey) {
    return new URL(`../../../pbr_tiles/${tileKey}/`, import.meta.url).href;
  }

  async ensureTileLoaded(tileKey) {
    if (this.tileLibrary[tileKey]) return this.tileLibrary[tileKey];

    const base = this.tileBaseUrl(tileKey);
    const [map, normalMap, roughnessMap, aoMap, displacementMap] = await Promise.all([
      this.loadTexture(base + "basecolor.jpg", true),
      this.loadTexture(base + "normal.jpg"),
      this.loadTexture(base + "roughness.jpg"),
      this.loadTexture(base + "ao.jpg"),
      this.loadTexture(base + "displacement.jpg")
    ]);

    const enhancedMap = createStage2BaseColorTexture(map, tileKey);
    const maps = { map: enhancedMap, normalMap, roughnessMap, aoMap, displacementMap };

    if (!maps.map) {
      console.warn(`Tile set '${tileKey}' could not be loaded from`, base);
    }

    this.tileLibrary[tileKey] = maps;
    return maps;
  }

  getSurfaceKind(mesh, fallback = "default") {
    const data = mesh?.userData || {};
    if (data.isFloor || data.type === "floor") return "floor";
    if (data.isStep || data.type === "step") return "step";
    if (data.isWall || data.type === "wall" || data.forceVerticalUV) return "wall";
    return fallback;
  }

  ensureAoUv(mesh) {
    if (!mesh?.geometry?.attributes?.uv) return;
    if (!mesh.geometry.attributes.uv2) {
      mesh.geometry.setAttribute("uv2", mesh.geometry.attributes.uv.clone());
    }
  }

  disposePreviousMaterial(mesh) {
    const oldMat = mesh?.material;
    if (!oldMat || oldMat.userData?.keepAlive) return;
    if (Array.isArray(oldMat)) oldMat.forEach((m) => m?.dispose?.());
    else oldMat.dispose?.();
  }

  buildTileMaterial(maps, mesh, surfaceKind = "default") {
    const settings = TILE_SURFACE_SETTINGS[surfaceKind] || TILE_SURFACE_SETTINGS.default;
    const profile = TILE_UV_STAGE2_PROFILES[surfaceKind] || TILE_UV_STAGE2_PROFILES.default;
    const surfaceMaps = {
      map: cloneTextureForSurface(maps.map, profile),
      normalMap: cloneTextureForSurface(maps.normalMap, profile),
      roughnessMap: cloneTextureForSurface(maps.roughnessMap, profile),
      aoMap: cloneTextureForSurface(maps.aoMap, profile),
      displacementMap: cloneTextureForSurface(maps.displacementMap, profile)
    };
    const hasRoughnessMap = Boolean(surfaceMaps.roughnessMap);
    const hasNormalMap = Boolean(surfaceMaps.normalMap);
    const useDisplacement = Boolean(surfaceMaps.displacementMap && settings.displacementScale > 0);

    const mat = new THREE.MeshPhysicalMaterial({
      map: surfaceMaps.map,
      normalMap: hasNormalMap ? surfaceMaps.normalMap : null,
      roughnessMap: hasRoughnessMap ? surfaceMaps.roughnessMap : null,
      aoMap: surfaceMaps.aoMap || null,
      displacementMap: useDisplacement ? surfaceMaps.displacementMap : null,
      displacementScale: useDisplacement ? settings.displacementScale : 0,
      metalness: 0.0,
      roughness: hasRoughnessMap ? settings.roughness : Math.min(0.58, settings.roughness + 0.12),
      envMapIntensity: settings.envMapIntensity,
      clearcoat: settings.clearcoat,
      clearcoatRoughness: settings.clearcoatRoughness,
      reflectivity: 0.36,
      sheen: 0.0
    });

    if (hasNormalMap) {
      const boostedNormal = settings.normalScale * (profile.groutBoost || 1);
      mat.normalScale = new THREE.Vector2(boostedNormal, boostedNormal);
    }

    mat.userData.isRealisticPoolTileMaterial = true;
    mat.userData.isStage2TileRealismMaterial = true;
    mat.userData.surfaceKind = surfaceKind;
    mat.userData.stage2TextureRepeat = profile.repeat;
    return mat;
  }

  async applyCurrentToGroup(group = null) {
    if (group) this.poolGroup = group;
    if (!this.poolGroup) return;

    const maps = await this.ensureTileLoaded(this.currentTileKey);
    if (!maps || !maps.map) return;

    this.caustics?.reset?.();

    this.poolGroup.traverse((mesh) => {
      if (!mesh.isMesh || !mesh.geometry) return;
      if (mesh.userData?.isCoping) return;
      if (mesh === this.poolGroup.userData?.waterMesh) return;

      const surfaceKind = this.getSurfaceKind(mesh, "default");
      this.ensureAoUv(mesh);
      const mat = this.buildTileMaterial(maps, mesh, surfaceKind);

      this.caustics?.addToMaterial?.(mat);

      this.disposePreviousMaterial(mesh);
      mesh.material = mat;
      mesh.material.needsUpdate = true;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });

    spas.forEach((spa) => this.applyTilesToSpa(spa));
  }

  async applyTilesToSpa(spa) {
    if (!spa) return;

    const maps = await this.ensureTileLoaded(this.currentTileKey);
    if (!maps || !maps.map) return;

    spa.traverse((mesh) => {
      if (!mesh.isMesh || mesh.userData?.isSpaWater) return;

      const surfaceKind = this.getSurfaceKind(mesh, "spa");
      this.ensureAoUv(mesh);
      const mat = this.buildTileMaterial(maps, mesh, surfaceKind);

      this.caustics?.addToMaterial?.(mat);

      this.disposePreviousMaterial(mesh);
      mesh.material = mat;
      mesh.material.needsUpdate = true;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });
  }
}
