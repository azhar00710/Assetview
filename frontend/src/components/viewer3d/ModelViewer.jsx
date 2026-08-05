import { useRef, useCallback, useEffect, useState, Suspense } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, Environment, Html, useProgress } from '@react-three/drei';
import * as THREE from 'three';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';

import useModelLoader from './hooks/useModelLoader';
import useTagMap from './hooks/useTagMap';
import GhostContext from './GhostContext';
import HighlightManager from './HighlightManager';
import selectionBus from '../../lib/SelectionBus';
import { md } from '../../lib/theme';

// Install BVH for accelerated raycasting (insight N16)
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

/**
 * ModelViewer — Three.js 3D model viewer with:
 *   - glTF loading with progress
 *   - BVH-accelerated raycasting (N16)
 *   - Tag→Group mapping (1:N, N22)
 *   - Ghost context rendering (N8)
 *   - SelectionBus integration (N9)
 *   - Emissive highlight on selection
 *   - Camera fly-to on tag select
 */
export default function ModelViewer({
  modelUrl,
  onTagSelect,
  selectedTag,
  ghostEnabled = true,
  onClose,
}) {
  return (
    <div className="relative w-full h-full" style={{ background: md.surface }}>
      {/* Close button */}
      {onClose && (
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-20 md-icon-btn w-9 h-9"
          style={{ background: md.surfaceContainer }}
          title="Close 3D Viewer"
        >
          <span className="material-symbols-outlined text-[20px]" style={{ color: md.onSurface }}>
            close
          </span>
        </button>
      )}

      {/* Tag label overlay */}
      {selectedTag && (
        <div
          className="absolute top-3 left-3 z-20 px-3 py-1.5 rounded-lg text-label-md font-semibold"
          style={{
            background: md.primaryContainer,
            color: md.onPrimaryContainer,
          }}
        >
          {selectedTag}
        </div>
      )}

      {/* Ghost context toggle */}
      <button
        onClick={() => {}}
        className="absolute bottom-3 left-3 z-20 px-3 py-1.5 rounded-lg text-label-sm"
        style={{
          background: ghostEnabled ? md.primaryContainer : md.surfaceContainer,
          color: ghostEnabled ? md.onPrimaryContainer : md.onSurfaceVariant,
        }}
        title="Toggle ghost context rendering"
      >
        Ghost Context
      </button>

      <Canvas
        camera={{ position: [50, 30, 50], fov: 45, near: 0.1, far: 10000 }}
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }}
        style={{ background: md.surfaceDim }}
      >
        <Suspense fallback={<LoadingIndicator />}>
          <SceneContent
            modelUrl={modelUrl}
            selectedTag={selectedTag}
            ghostEnabled={ghostEnabled}
            onTagSelect={onTagSelect}
          />
        </Suspense>
      </Canvas>
    </div>
  );
}

function LoadingIndicator() {
  const { progress } = useProgress();
  return (
    <Html center>
      <div
        className="flex flex-col items-center gap-2 px-6 py-4 rounded-xl"
        style={{ background: md.surfaceContainer, color: md.onSurface }}
      >
        <div className="text-title-sm font-semibold">Loading 3D Model</div>
        <div className="w-48 h-1.5 rounded-full overflow-hidden" style={{ background: md.surfaceContainerHigh }}>
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{ width: `${progress}%`, background: md.primary }}
          />
        </div>
        <div className="text-label-sm" style={{ color: md.onSurfaceVariant }}>
          {Math.round(progress)}%
        </div>
      </div>
    </Html>
  );
}

function SceneContent({ modelUrl, selectedTag, ghostEnabled, onTagSelect }) {
  const { camera } = useThree();
  const controlsRef = useRef();
  const { scene, isLoading, error } = useModelLoader(modelUrl);
  const tagMap = useTagMap(scene);

  // Compute BVH for all meshes after load
  useEffect(() => {
    if (!scene) return;
    scene.traverse((obj) => {
      if (obj.isMesh && obj.geometry) {
        try {
          obj.geometry.computeBoundsTree();
        } catch {
          // Some geometries may not support BVH
        }
      }
    });

    return () => {
      scene.traverse((obj) => {
        if (obj.isMesh && obj.geometry?.boundsTree) {
          obj.geometry.disposeBoundsTree();
        }
      });
    };
  }, [scene]);

  // Listen for tag:select from 2D canvas
  useEffect(() => {
    const unsubSelect = selectionBus.on('tag:select', ({ tag, source }) => {
      if (source === '3d') return; // Don't react to our own events
      flyToTag(tag);
    });

    const unsubFlyTo = selectionBus.on('camera:flyto', ({ position, target }) => {
      flyToPosition(position, target);
    });

    return () => {
      unsubSelect();
      unsubFlyTo();
    };
  }, [tagMap]);

  // Camera fly-to when selectedTag changes
  useEffect(() => {
    if (selectedTag && tagMap.has(selectedTag)) {
      flyToTag(selectedTag);
    }
  }, [selectedTag, tagMap]);

  const flyToTag = useCallback(
    (tag) => {
      const obj = tagMap.get(tag);
      if (!obj) return;

      const box = new THREE.Box3().setFromObject(obj);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      const distance = maxDim * 3;

      const targetPos = new THREE.Vector3(
        center.x + distance * 0.7,
        center.y + distance * 0.5,
        center.z + distance * 0.7,
      );

      flyToPosition(targetPos, center);
    },
    [tagMap],
  );

  const flyToPosition = useCallback(
    (position, target) => {
      if (!controlsRef.current) return;
      const controls = controlsRef.current;

      // Animate camera position
      const startPos = camera.position.clone();
      const startTarget = controls.target.clone();
      const endPos = new THREE.Vector3(position.x || position[0], position.y || position[1], position.z || position[2]);
      const endTarget = new THREE.Vector3(target.x || target[0], target.y || target[1], target.z || target[2]);

      let t = 0;
      const duration = 1000; // ms
      const startTime = performance.now();

      const animate = () => {
        const elapsed = performance.now() - startTime;
        t = Math.min(elapsed / duration, 1);
        // Ease out cubic
        const eased = 1 - Math.pow(1 - t, 3);

        camera.position.lerpVectors(startPos, endPos, eased);
        controls.target.lerpVectors(startTarget, endTarget, eased);
        controls.update();

        if (t < 1) requestAnimationFrame(animate);
      };

      animate();
    },
    [camera],
  );

  // Raycasting click handler
  const handleClick = useCallback(
    (event) => {
      if (!scene) return;

      const raycaster = new THREE.Raycaster();
      const pointer = new THREE.Vector2();

      const rect = event.target.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(pointer, camera);
      const intersects = raycaster.intersectObject(scene, true);

      if (intersects.length === 0) {
        if (onTagSelect) onTagSelect(null);
        selectionBus.emit('tag:deselect', { tag: selectedTag, source: '3d' });
        return;
      }

      // Walk up hierarchy to find tagged object
      let hit = intersects[0].object;
      let tag = null;

      while (hit) {
        if (hit.userData?.tag) {
          tag = hit.userData.tag;
          break;
        }
        if (hit.name && tagMap.has(hit.name)) {
          tag = hit.name;
          break;
        }
        hit = hit.parent;
      }

      if (tag) {
        if (onTagSelect) onTagSelect(tag);
        selectionBus.emit('tag:select', { tag, source: '3d' });
      }
    },
    [scene, camera, tagMap, onTagSelect, selectedTag],
  );

  // Resolve selectedObject for GhostContext
  const selectedObject = selectedTag ? tagMap.get(selectedTag) || null : null;

  if (error) {
    return (
      <Html center>
        <div
          className="px-6 py-4 rounded-xl text-center"
          style={{ background: md.errorContainer, color: md.onErrorContainer }}
        >
          <div className="text-title-sm font-semibold mb-1">Failed to load model</div>
          <div className="text-body-sm">{error}</div>
        </div>
      </Html>
    );
  }

  if (!modelUrl) {
    return (
      <Html center>
        <div
          className="px-6 py-4 rounded-xl text-center"
          style={{ background: md.surfaceContainer, color: md.onSurfaceVariant }}
        >
          <div className="text-title-sm font-semibold mb-1">No 3D Model</div>
          <div className="text-body-sm">Select a platform with a 3D model to view</div>
        </div>
      </Html>
    );
  }

  return (
    <>
      {/* Lighting */}
      <ambientLight intensity={0.4} />
      <directionalLight position={[50, 80, 50]} intensity={0.8} castShadow />
      <directionalLight position={[-30, 40, -20]} intensity={0.3} />

      {/* Environment for reflections */}
      <Environment preset="city" />

      {/* Controls */}
      <OrbitControls
        ref={controlsRef}
        enableDamping
        dampingFactor={0.1}
        minDistance={1}
        maxDistance={5000}
      />

      {/* Model */}
      {scene && (
        <primitive object={scene} onClick={handleClick} />
      )}

      {/* Ghost context */}
      <GhostContext
        scene={scene}
        selectedObject={selectedObject}
        enabled={ghostEnabled}
      />

      {/* Highlight */}
      <HighlightManager tagMap={tagMap} selectedTag={selectedTag} />

      {/* Ground grid */}
      <gridHelper args={[200, 50, md.outline, md.outlineVariant]} position={[0, -0.01, 0]} />
    </>
  );
}
