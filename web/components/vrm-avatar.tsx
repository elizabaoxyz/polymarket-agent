"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRM } from "@pixiv/three-vrm";

export default function VrmAvatar() {
  const containerRef = useRef<HTMLDivElement>(null);
  const vrmRef = useRef<VRM | null>(null);
  const clockRef = useRef(new THREE.Clock());

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = 200;
    const height = 280;

    // Scene
    const scene = new THREE.Scene();

    // Camera
    const camera = new THREE.PerspectiveCamera(25, width / height, 0.1, 20);
    camera.position.set(0, 1.2, 3);
    camera.lookAt(0, 1.0, 0);

    // Renderer
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0x00d4aa, 1.2);
    directionalLight.position.set(1, 2, 2);
    scene.add(directionalLight);

    const backLight = new THREE.DirectionalLight(0x00d4aa, 0.4);
    backLight.position.set(-1, 1, -1);
    scene.add(backLight);

    // Load VRM
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));

    loader.load(
      "/eliza_hat.vrm",
      (gltf) => {
        const vrm = gltf.userData.vrm as VRM;
        vrmRef.current = vrm;
        scene.add(vrm.scene);

        // Rotate to face camera
        vrm.scene.rotation.y = Math.PI;
      },
      undefined,
      (error) => {
        console.error("VRM load error:", error);
      },
    );

    // Animate
    let animationId: number;
    const animate = () => {
      animationId = requestAnimationFrame(animate);
      const delta = clockRef.current.getDelta();

      if (vrmRef.current) {
        // Gentle idle sway
        const time = clockRef.current.elapsedTime;
        vrmRef.current.scene.rotation.y = Math.PI + Math.sin(time * 0.5) * 0.05;

        vrmRef.current.update(delta);
      }

      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animationId);
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="fixed bottom-0 right-[270px] z-30 pointer-events-none"
      style={{ width: 200, height: 280 }}
    />
  );
}
