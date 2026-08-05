import { useEffect, useRef } from 'react';
import * as THREE from 'three';

/**
 * HighlightManager — Selection highlighting with emissive glow.
 *
 * When a tag is selected, applies an emissive glow to ALL meshes
 * belonging to that tag's Object3D group (tag→mesh is 1:N per N22).
 */

const HIGHLIGHT_COLOR = new THREE.Color(0x4fe2b0); // primary teal
const HIGHLIGHT_EMISSIVE_INTENSITY = 0.6;

export default function HighlightManager({ tagMap, selectedTag }) {
  const highlightedRef = useRef([]);

  useEffect(() => {
    // Clear previous highlights
    clearHighlights(highlightedRef.current);
    highlightedRef.current = [];

    if (!selectedTag || !tagMap?.has(selectedTag)) return;

    const obj = tagMap.get(selectedTag);
    const meshes = [];

    obj.traverse((child) => {
      if (child.isMesh) {
        meshes.push({
          mesh: child,
          originalEmissive: child.material.emissive?.clone() || new THREE.Color(0),
          originalEmissiveIntensity: child.material.emissiveIntensity ?? 0,
        });

        // Apply highlight
        child.material = child.material.clone();
        child.material.emissive = HIGHLIGHT_COLOR;
        child.material.emissiveIntensity = HIGHLIGHT_EMISSIVE_INTENSITY;
        child.material.needsUpdate = true;
      }
    });

    highlightedRef.current = meshes;

    return () => {
      clearHighlights(highlightedRef.current);
      highlightedRef.current = [];
    };
  }, [tagMap, selectedTag]);

  return null; // Render-less component
}

function clearHighlights(meshes) {
  for (const { mesh, originalEmissive, originalEmissiveIntensity } of meshes) {
    if (mesh.parent && mesh.material) {
      mesh.material.emissive = originalEmissive;
      mesh.material.emissiveIntensity = originalEmissiveIntensity;
      mesh.material.needsUpdate = true;
    }
  }
}
