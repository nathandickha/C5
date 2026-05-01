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

    // Work out whether this tile set is naturally light or dark.  The first
    // Stage 2 pass used a fixed light grout, which worked on the blue tile but
    // became nearly invisible on the white tile.  This keeps the enhancement
    // tile-set agnostic: light tiles get darker grout, dark tiles get lighter
    // grout, and coloured mid-tone tiles keep a softer light grout.
    let avgLuma = 0;
    let avgSat = 0;
    const sampleStride = Math.max(4, Math.floor(Math.sqrt((width * height) / 3500)));
    let sampleCount = 0;
    for (let sy = 0; sy < height; sy += sampleStride) {
      for (let sx = 0; sx < width; sx += sampleStride) {
        const sIdx = (sy * width + sx) * 4;
        const sr = data[sIdx] / 255;
        const sg = data[sIdx + 1] / 255;
        const sb = data[sIdx + 2] / 255;
        const sMax = Math.max(sr, sg, sb);
        const sMin = Math.min(sr, sg, sb);
        avgLuma += sr * 0.2126 + sg * 0.7152 + sb * 0.0722;
        avgSat += sMax - sMin;
        sampleCount++;
      }
    }
    avgLuma = sampleCount ? avgLuma / sampleCount : 0.5;
    avgSat = sampleCount ? avgSat / sampleCount : 0.2;

    const isLightTile = avgLuma > 0.58 && avgSat < 0.28;
    const isDarkTile = avgLuma < 0.34;
    const groutTarget = isLightTile ? 0.36 : isDarkTile ? 0.74 : 0.78;
    const groutMix = isLightTile ? 0.72 : 0.58;
    const variationStrength = isLightTile ? 0.06 : 0.085;
    const microStrength = isLightTile ? 0.014 : 0.018;

    for (let y = 0; y < height; y++) {
      const gy = (y / height) * TILE_SOURCE_GRID;
      const fy = gy - Math.floor(gy);
      const iy = Math.floor(gy);
      const nearHorizontalGrout = Math.min(fy, 1 - fy) < TILE_GROUT_WIDTH;

      for (let x = 0; x < width; x++) {
        const gx = (x / width) * TILE_SOURCE_GRID;
        const fx = gx - Math.floor(gx);
        const ix = Math.floor(gx);
        const nearVerticalGrout = Math.min(fx, 1 - fx) < TILE_GROUT_WIDTH;
        const idx = (y * width + x) * 4;

        let r = data[idx] / 255;
        let g = data[idx + 1] / 255;
        let b = data[idx + 2] / 255;

        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const sat = max - min;
        const luma = r * 0.2126 + g * 0.7152 + b * 0.0722;
        // Do not treat the whole white tile as grout just because it is bright
        // and low saturation.  Only use this old-source grout detection on
        // darker/coloured tiles where it won't flatten the tile face.
        const existingGrout = !isLightTile && luma > 0.72 && sat < 0.22;
        const groutMask = nearVerticalGrout || nearHorizontalGrout || existingGrout;

        if (groutMask) {
          const mix = nearVerticalGrout || nearHorizontalGrout ? groutMix : 0.34;
          r = r * (1 - mix) + groutTarget * mix;
          g = g * (1 - mix) + groutTarget * mix;
          b = b * (1 - mix) + groutTarget * mix;
        } else {
          const variation = (seededTileVariation(ix, iy, seed) - 0.5) * variationStrength;
          const micro = (seededTileVariation(x >> 4, y >> 4, seed + 7) - 0.5) * microStrength;
          const contrast = isLightTile ? 1.035 : 1.045;
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
