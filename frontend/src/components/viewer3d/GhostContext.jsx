import { useEffect, useRef } from 'react';
import * as THREE from 'three';

/**
 * GhostContext — Distance-based opacity rendering (insight N8).
 *
 * selected equipment = full opacity (1.0)
 * within 20-30m       = 50% opacity
 * everything else     = 10% opacity
 *
 * Stores original materials so they can be restored on deselection.
 */

const NEAR_RADIUS = 20; // metres — full → semi-transparent transition
const FAR_RADIUS = 30; // metres — semi-transparent → ghost transition
const GHOST_OPACITY = 0.1;
const NEAR_OPACITY = 0.5;
const FULL_OPACITY = 1.0;

export default function GhostContext({ scene, selectedObject, enabled = true }) {
  const originalsRef = useRef(new Map());

  useEffect(() => {
    if (!scene) return;

    const originals = originalsRef.current;

    // Restore originals first
    restoreOriginals(scene, originals);

    if (!enabled || !selectedObject) return;

    // Compute world position of selected object
    const selectedPos = new THREE.Vector3();
    selectedObject.getWorldPosition(selectedPos);

    // Get the bounding sphere of selected to determine its extent
    const selectedBounds = new THREE.Box3().setFromObject(selectedObject);
    const selectedMeshes = new Set();
    selectedObject.traverse((child) => {
      if (child.isMesh) selectedMeshes.add(child);
    });

    // Apply ghost context to all meshes
    scene.traverse((obj) => {
      if (!obj.isMesh) return;

      // Selected meshes stay fully opaque
      if (selectedMeshes.has(obj)) return;

      const objPos = new THREE.Vector3();
      obj.getWorldPosition(objPos);
      const distance = objPos.distanceTo(selectedPos);

      let targetOpacity;
      if (distance <= NEAR_RADIUS) {
        targetOpacity = NEAR_OPACITY;
      } else if (distance <= FAR_RADIUS) {
        // Linear interpolation between near and ghost
        const t = (distance - NEAR_RADIUS) / (FAR_RADIUS - NEAR_RADIUS);
        targetOpacity = NEAR_OPACITY + t * (GHOST_OPACITY - NEAR_OPACITY);
      } else {
        targetOpacity = GHOST_OPACITY;
      }

      // Store original material if not already stored
      if (!originals.has(obj)) {
        originals.set(obj, obj.material.clone());
      }

      // Apply transparent material
      obj.material = obj.material.clone();
      obj.material.transparent = true;
      obj.material.opacity = targetOpacity;
      obj.material.depthWrite = targetOpacity > 0.5;
      obj.material.needsUpdate = true;
    });

    return () => {
      restoreOriginals(scene, originals);
    };
  }, [scene, selectedObject, enabled]);

  return null; // Render-less component
}

function restoreOriginals(scene, originals) {
  for (const [mesh, originalMaterial] of originals) {
    if (mesh.parent) {
      mesh.material.dispose();
      mesh.material = originalMaterial;
    }
  }
  originals.clear();
}
