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

    const maps = { map, normalMap, roughnessMap, aoMap, displacementMap };

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
    const hasRoughnessMap = Boolean(maps.roughnessMap);
    const hasNormalMap = Boolean(maps.normalMap);
    const useDisplacement = Boolean(maps.displacementMap && settings.displacementScale > 0);

    const mat = new THREE.MeshPhysicalMaterial({
      map: maps.map,
      normalMap: hasNormalMap ? maps.normalMap : null,
      roughnessMap: hasRoughnessMap ? maps.roughnessMap : null,
      aoMap: maps.aoMap || null,
      displacementMap: useDisplacement ? maps.displacementMap : null,
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
      mat.normalScale = new THREE.Vector2(settings.normalScale, settings.normalScale);
    }

    mat.userData.isRealisticPoolTileMaterial = true;
    mat.userData.surfaceKind = surfaceKind;
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
