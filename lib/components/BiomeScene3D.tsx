'use client';
/**
 * Real-time 3D biome backdrop powered by three.js + react-three-fiber.
 *
 * Each act gets a procedurally-generated terrain that matches its theme:
 *   - displaced plane mesh for hills/dunes/seafloor
 *   - per-biome fog colour and density
 *   - point lights placed for accent + atmosphere
 *   - scattered biome props (crystals, rocks, embers, trees, kelp, dunes,
 *     obelisks, halos) built from primitive geometries
 *   - winding camera-locked path traced in a TubeGeometry
 *
 * No GLTF assets, no textures: everything is mesh + material so the bundle
 * stays small and there are no asset downloads at runtime.
 *
 * Mounted as a fixed-position canvas BEHIND the SVG path/node layer so the
 * existing Candy-Crush map still works for clicks; the 3D scene is purely
 * decorative depth.
 */

import React, { Suspense, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Biome } from '@/lib/game/biomes';

interface Props {
  biome: Biome;
  /** 0–1 progress along the act (active level relative to act length). */
  progress: number;
}

/** Deterministic PRNG so each biome renders the same scene every reload. */
function seeded(seed: number) {
  return () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
}

/** Per-biome physical params for the procedural scene. */
const BIOME_3D: Record<string, {
  fog: string;
  ground: string;
  groundEmissive: string;
  ambient: string;
  key: string;
  rim: string;
  hillStrength: number;  // vertical displacement scale
  hillFreq: number;      // displacement noise frequency
  propType: 'crystal' | 'pine' | 'volcano' | 'tree' | 'kelp' | 'dune' | 'obelisk' | 'altar';
  propCount: number;
  propColors: [string, string];
}> = {
  crystal:  { fog: '#161830', ground: '#1f1d3a', groundEmissive: '#2a1b54', ambient: '#a78bfa', key: '#bae6fd', rim: '#f0abfc', hillStrength: 2.6,  hillFreq: 0.20, propType: 'crystal', propCount: 28, propColors: ['#a78bfa', '#67e8f9'] },
  frost:    { fog: '#102a44', ground: '#1e3a5f', groundEmissive: '#2a5b85', ambient: '#7dd3fc', key: '#bae6fd', rim: '#a78bfa', hillStrength: 3.2,  hillFreq: 0.16, propType: 'pine',    propCount: 36, propColors: ['#0e3127', '#0a1f1a'] },
  ember:    { fog: '#2a0e08', ground: '#3d1f15', groundEmissive: '#7c2d12', ambient: '#fb923c', key: '#fcd34d', rim: '#ef4444', hillStrength: 4.0,  hillFreq: 0.18, propType: 'volcano', propCount: 16, propColors: ['#fb923c', '#7c2d12'] },
  verdant:  { fog: '#0a1f14', ground: '#14352a', groundEmissive: '#166534', ambient: '#86efac', key: '#fef08a', rim: '#22c55e', hillStrength: 2.4,  hillFreq: 0.22, propType: 'tree',    propCount: 32, propColors: ['#22c55e', '#1f5236'] },
  tidewave: { fog: '#072036', ground: '#0c2540', groundEmissive: '#0c4a6e', ambient: '#22d3ee', key: '#67e8f9', rim: '#a78bfa', hillStrength: 1.8,  hillFreq: 0.30, propType: 'kelp',    propCount: 40, propColors: ['#22d3ee', '#0e7490'] },
  dunes:    { fog: '#2a1808', ground: '#a16207', groundEmissive: '#ca8a04', ambient: '#fcd34d', key: '#fef3c7', rim: '#fbbf24', hillStrength: 3.6,  hillFreq: 0.14, propType: 'dune',    propCount: 22, propColors: ['#fbbf24', '#7c2d12'] },
  voidline: { fog: '#0a061c', ground: '#1a0f3a', groundEmissive: '#4c1d95', ambient: '#c084fc', key: '#f0abfc', rim: '#fff',    hillStrength: 3.0,  hillFreq: 0.19, propType: 'obelisk', propCount: 22, propColors: ['#c084fc', '#1a0f3a'] },
  apex:     { fog: '#1a0708', ground: '#2a0e3a', groundEmissive: '#a16207', ambient: '#fbbf24', key: '#fff',    rim: '#fcd34d', hillStrength: 3.4,  hillFreq: 0.16, propType: 'altar',   propCount: 14, propColors: ['#fbbf24', '#7e22ce'] },
};

/** Smooth value noise (deterministic, no extra deps). */
function valueNoise2D(x: number, z: number, freq: number): number {
  const k = (n: number) => {
    const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
    return s - Math.floor(s);
  };
  const xf = x * freq, zf = z * freq;
  const xi = Math.floor(xf), zi = Math.floor(zf);
  const xt = xf - xi, zt = zf - zi;
  const sm = (t: number) => t * t * (3 - 2 * t);
  const u = sm(xt), v = sm(zt);
  const a = k(xi + zi * 57);
  const b = k((xi + 1) + zi * 57);
  const c = k(xi + (zi + 1) * 57);
  const d = k((xi + 1) + (zi + 1) * 57);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, u), THREE.MathUtils.lerp(c, d, u), v);
}

/** Procedurally displaced terrain plane. */
function Terrain({ biome, params }: { biome: Biome; params: typeof BIOME_3D[string] }) {
  const geo = useMemo(() => {
    // Was 96 segments (9,216 quads) — overkill for an ambient backdrop.
    // 48 still reads as a smooth landscape, costs a quarter of the vertices.
    const seg = 48;
    const size = 60;
    const g = new THREE.PlaneGeometry(size, size, seg, seg);
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getY(i); // PlaneGeometry's local Y becomes world Z after rotation
      const n =
        valueNoise2D(x, z, params.hillFreq) * 0.7 +
        valueNoise2D(x, z, params.hillFreq * 2.3) * 0.2 +
        valueNoise2D(x, z, params.hillFreq * 4.7) * 0.1;
      pos.setZ(i, (n - 0.5) * params.hillStrength * 2);
    }
    pos.needsUpdate = true;
    g.computeVertexNormals();
    return g;
  }, [biome.id, params.hillFreq, params.hillStrength]);

  return (
    <mesh geometry={geo} rotation={[-Math.PI / 2, 0, 0]} position={[0, -1, 0]} receiveShadow>
      <meshStandardMaterial
        color={params.ground}
        emissive={params.groundEmissive}
        emissiveIntensity={0.25}
        roughness={0.95}
        metalness={0.05}
        flatShading
      />
    </mesh>
  );
}

/** Per-biome scattered props. */
function Props({ biome, params }: { biome: Biome; params: typeof BIOME_3D[string] }) {
  const rng = useMemo(() => seeded(biome.act * 1009 + 17), [biome.id]);
  const items = useMemo(() => {
    const arr: { x: number; z: number; s: number; rot: number; tone: number }[] = [];
    for (let i = 0; i < params.propCount; i++) {
      arr.push({
        x: (rng() - 0.5) * 56,
        z: (rng() - 0.5) * 56,
        s: 0.6 + rng() * 1.8,
        rot: rng() * Math.PI * 2,
        tone: rng() < 0.5 ? 0 : 1,
      });
    }
    return arr;
  }, [biome.id, params.propCount, rng]);

  const [c1, c2] = params.propColors;

  return (
    <group>
      {items.map((p, i) => {
        const color = p.tone === 0 ? c1 : c2;
        const y = valueNoise2D(p.x, p.z, params.hillFreq) * params.hillStrength - 1;
        const key = `${biome.id}-${i}`;
        switch (params.propType) {
          case 'crystal':
            return (
              <mesh key={key} position={[p.x, y + p.s * 1.2, p.z]} rotation={[0, p.rot, 0]} castShadow>
                <coneGeometry args={[p.s * 0.35, p.s * 2.2, 5]} />
                <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.55} roughness={0.2} metalness={0.4} />
              </mesh>
            );
          case 'pine':
            return (
              <group key={key} position={[p.x, y, p.z]} rotation={[0, p.rot, 0]}>
                <mesh position={[0, p.s * 0.5, 0]} castShadow>
                  <cylinderGeometry args={[p.s * 0.08, p.s * 0.1, p.s * 1.0, 6]} />
                  <meshStandardMaterial color="#3b2218" roughness={0.9} />
                </mesh>
                <mesh position={[0, p.s * 1.8, 0]} castShadow>
                  <coneGeometry args={[p.s * 0.7, p.s * 2.0, 8]} />
                  <meshStandardMaterial color={color} roughness={0.85} />
                </mesh>
                <mesh position={[0, p.s * 2.6, 0]} castShadow>
                  <coneGeometry args={[p.s * 0.45, p.s * 1.0, 8]} />
                  <meshStandardMaterial color={color} roughness={0.85} />
                </mesh>
              </group>
            );
          case 'volcano':
            // No per-volcano pointLight — WebGL limits total lights to
            // ~16, and 32 volcanoes would crash the GL context. Use a
            // hot emissive top cap so each volcano still looks lit.
            return (
              <group key={key} position={[p.x, y, p.z]} rotation={[0, p.rot, 0]}>
                <mesh castShadow>
                  <coneGeometry args={[p.s * 1.4, p.s * 2.6, 10]} />
                  <meshStandardMaterial color="#3d1f15" emissive="#7c2d12" emissiveIntensity={0.35} roughness={0.9} />
                </mesh>
                <mesh position={[0, p.s * 2.6, 0]}>
                  <sphereGeometry args={[p.s * 0.35, 8, 6]} />
                  <meshStandardMaterial color="#fbbf24" emissive="#fbbf24" emissiveIntensity={1.4} />
                </mesh>
              </group>
            );
          case 'tree':
            return (
              <group key={key} position={[p.x, y, p.z]} rotation={[0, p.rot, 0]}>
                <mesh position={[0, p.s * 0.7, 0]} castShadow>
                  <cylinderGeometry args={[p.s * 0.12, p.s * 0.15, p.s * 1.4, 6]} />
                  <meshStandardMaterial color="#3b2218" roughness={0.9} />
                </mesh>
                <mesh position={[0, p.s * 1.8, 0]} castShadow>
                  <sphereGeometry args={[p.s * 0.9, 10, 10]} />
                  <meshStandardMaterial color={color} roughness={0.8} flatShading />
                </mesh>
                <mesh position={[p.s * 0.5, p.s * 1.5, p.s * 0.2]} castShadow>
                  <sphereGeometry args={[p.s * 0.55, 8, 8]} />
                  <meshStandardMaterial color={c1} roughness={0.85} flatShading />
                </mesh>
              </group>
            );
          case 'kelp':
            return (
              <mesh key={key} position={[p.x, y + p.s * 1.5, p.z]} rotation={[0, p.rot, 0]} castShadow>
                <cylinderGeometry args={[p.s * 0.08, p.s * 0.18, p.s * 3.0, 6]} />
                <meshStandardMaterial color={color} emissive={c2} emissiveIntensity={0.35} roughness={0.7} />
              </mesh>
            );
          case 'dune':
            return (
              <mesh key={key} position={[p.x, y, p.z]} rotation={[0, p.rot, 0]} castShadow>
                <sphereGeometry args={[p.s * 1.6, 12, 6]} />
                <meshStandardMaterial color={color} roughness={1.0} flatShading />
              </mesh>
            );
          case 'obelisk':
            return (
              <mesh key={key} position={[p.x, y + p.s * 1.4, p.z]} rotation={[0, p.rot, 0]} castShadow>
                <boxGeometry args={[p.s * 0.5, p.s * 3.0, p.s * 0.5]} />
                <meshStandardMaterial color={color} emissive={c2} emissiveIntensity={0.4} roughness={0.4} metalness={0.6} />
              </mesh>
            );
          case 'altar':
            return (
              <group key={key} position={[p.x, y, p.z]} rotation={[0, p.rot, 0]}>
                <mesh castShadow>
                  <cylinderGeometry args={[p.s * 0.9, p.s * 1.1, p.s * 0.4, 8]} />
                  <meshStandardMaterial color="#1a0524" roughness={0.6} />
                </mesh>
                <mesh position={[0, p.s * 0.8, 0]} castShadow>
                  <torusGeometry args={[p.s * 0.7, p.s * 0.12, 8, 16]} />
                  <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.8} roughness={0.2} metalness={0.6} />
                </mesh>
              </group>
            );
        }
      })}
    </group>
  );
}

/** A winding glowing path traced along the terrain. */
function WindingPath({ params, progress }: { params: typeof BIOME_3D[string]; progress: number }) {
  const curve = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    const N = 80;
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      const z = -28 + t * 56;
      const x = Math.sin(t * Math.PI * 4) * 14 + Math.sin(t * Math.PI * 1.3 + 1.2) * 6;
      const y = valueNoise2D(x, z, params.hillFreq) * params.hillStrength + 0.2;
      pts.push(new THREE.Vector3(x, y, z));
    }
    return new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.3);
  }, [params.hillFreq, params.hillStrength]);

  // Tube: 120 length-segments × 6 radial — plenty smooth at our zoom level
  // and much cheaper than the original 280×8.
  const geo = useMemo(() => new THREE.TubeGeometry(curve, 120, 0.45, 6, false), [curve]);

  return (
    <>
      <mesh geometry={geo}>
        <meshStandardMaterial
          color={params.key}
          emissive={params.key}
          emissiveIntensity={0.85}
          roughness={0.3}
          metalness={0.6}
        />
      </mesh>
      {/* Player marker — sphere placed at `progress` along the curve. */}
      <PlayerMarker curve={curve} progress={progress} color={params.rim} />
    </>
  );
}

function PlayerMarker({
  curve, progress, color,
}: { curve: THREE.CatmullRomCurve3; progress: number; color: string }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = THREE.MathUtils.clamp(progress, 0.005, 0.995);
    const p = curve.getPointAt(t);
    ref.current.position.set(p.x, p.y + 0.9 + Math.sin(clock.elapsedTime * 2) * 0.15, p.z);
  });
  return (
    <group ref={ref}>
      <mesh>
        <sphereGeometry args={[0.55, 24, 24]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.5} roughness={0.2} metalness={0.7} />
      </mesh>
      <pointLight color={color} intensity={2.5} distance={9} />
    </group>
  );
}

function Camera({ progress }: { progress: number }) {
  useFrame(({ camera, clock }) => {
    // Slow orbit around the path's current position so the scene always
    // feels alive.
    const targetZ = -28 + progress * 56;
    const angle = clock.elapsedTime * 0.05;
    const r = 26;
    camera.position.x = Math.sin(angle) * r;
    camera.position.z = targetZ + Math.cos(angle) * r + 2;
    camera.position.y = 14;
    camera.lookAt(0, 0, targetZ);
  });
  return null;
}

/**
 * Public component. Defensive: any error inside Canvas (WebGL context loss,
 * GPU memory exhaustion on integrated graphics, etc.) is swallowed so the
 * page falls back to the SVG-only layer instead of crashing.
 */
class WebGLBoundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err: unknown) {
    // eslint-disable-next-line no-console
    console.warn('[BiomeScene3D] disabled — WebGL error', err);
  }
  render() { return this.state.failed ? null : this.props.children; }
}

export default function BiomeScene3D({ biome, progress }: Props) {
  const params = BIOME_3D[biome.id] ?? BIOME_3D.crystal;
  return (
    <WebGLBoundary>
      <Canvas
        // Shadows + DPR 1.5 were too heavy on integrated GPUs. Shadows OFF,
        // DPR capped at 1.25, antialias off → much lighter, still looks good
        // at this zoom level since geometry is low-poly stylised anyway.
        dpr={[1, 1.25]}
        camera={{ position: [0, 14, 24], fov: 50, near: 0.1, far: 160 }}
        style={{ width: '100%', height: '100%' }}
        gl={{
          antialias: false,
          powerPreference: 'default',
          alpha: false,
          stencil: false,
          depth: true,
        }}
        frameloop="always"
        onCreated={(state) => {
          // Make WebGL context loss recoverable.
          state.gl.domElement.addEventListener('webglcontextlost', (e) => {
            e.preventDefault();
            // eslint-disable-next-line no-console
            console.warn('[BiomeScene3D] webglcontextlost — backing off');
          });
        }}
      >
        <color attach="background" args={[params.fog]} />
        <fog attach="fog" args={[params.fog, 22, 70]} />
        <ambientLight intensity={0.55} color={params.ambient} />
        <directionalLight
          position={[16, 18, 8]}
          intensity={1.0}
          color={params.key}
        />
        <Suspense fallback={null}>
          <Terrain biome={biome} params={params} />
          <Props biome={biome} params={params} />
          <WindingPath params={params} progress={progress} />
        </Suspense>
        <Camera progress={progress} />
      </Canvas>
    </WebGLBoundary>
  );
}
