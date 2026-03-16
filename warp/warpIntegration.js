// UCL, Bartlett, RC5
import * as THREE from 'three';
import { createWarpClient } from './warpClient.js';

export function createWarpIntegration({
  scene,
  room,
  onMeshAdded,
  onStatus,
}) {
  const group = new THREE.Group();
  group.name = 'Warp Group';
  scene.add(group);

  function clearGroup() {
    while (group.children.length) {
      const child = group.children.pop();
      child.geometry?.dispose();
      child.material?.dispose();
    }
  }

  function addGeometries(geometries) {
    clearGroup();

    geometries.forEach((geometry, i) => {
      const material = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.35,
        metalness: 0.5,
        envMapIntensity: 1.0,
        side: THREE.DoubleSide,
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `Warp Mesh ${i}`;
      group.add(mesh);

      onMeshAdded?.(mesh);
    });
  }

  const warp = createWarpClient({
    room,
    onStatus: (state, info) => {
      onStatus?.(state, info);
    },
    onMesh: ({ geometries }) => {
      addGeometries(geometries);
    },
  });

  function sendParams(paramsObj) {
    return warp?.sendJson?.({
      type: 'setParams',
      params: paramsObj || {},
    }) ?? false;
  }

  return {
    group,
    sendParams,
    dispose() {
      clearGroup();
      warp?.disconnect?.();
    },
  };

}
