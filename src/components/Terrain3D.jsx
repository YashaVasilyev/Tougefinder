import React, { useMemo, useEffect, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Stars, Environment, Text, Float } from '@react-three/drei';
import * as THREE from 'three';
import { fetchTerrainGrid } from '../services/elevation';
import { Loader2, X, Maximize2, Minimize2, Mountain } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs) {
  return twMerge(clsx(inputs));
}

const TerrainMesh = ({ gridData, heightScale }) => {
  const { grid } = gridData;
  const resolution = grid.length;

  const { minE, maxE } = useMemo(() => {
    const flat = grid.flat();
    return { minE: Math.min(...flat), maxE: Math.max(...flat) };
  }, [grid]);

  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(100, 100, resolution - 1, resolution - 1);
    const vertices = geo.attributes.position.array;
    const range = maxE - minE || 100;

    for (let i = 0; i < resolution; i++) {
      for (let j = 0; j < resolution; j++) {
        const index = (i * resolution + j) * 3;
        vertices[index + 2] = ((grid[i][j] - minE) / range) * heightScale;
      }
    }

    geo.computeVertexNormals();
    geo.attributes.position.needsUpdate = true;
    return geo;
  }, [grid, resolution, minE, maxE, heightScale]);

  return (
    <mesh geometry={geometry} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <meshStandardMaterial
        color="#27272a"
        roughness={0.7}
        metalness={0.1}
        flatShading={true}
      />
      <gridHelper args={[100, 15, '#333333', '#1f1f1f']} rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0.01]} />
    </mesh>
  );
};

const RoadLine = ({ roadCoords, gridData, elevationProfile, heightScale }) => {
  const { grid, minLat, maxLat, minLon, maxLon } = gridData;

  const minE = useMemo(() => Math.min(...grid.flat()), [grid]);
  const maxE = useMemo(() => Math.max(...grid.flat()), [grid]);
  const range = maxE - minE || 100;
  const resolution = grid.length;

  // Bilinear interpolation from grid
  const sampleGrid = (lat, lon) => {
    const u = (lon - minLon) / (maxLon - minLon); // 0..1
    const v = (lat - minLat) / (maxLat - minLat); // 0..1

    const col = u * (resolution - 1);
    const row = v * (resolution - 1);

    const col0 = Math.max(0, Math.min(resolution - 2, Math.floor(col)));
    const row0 = Math.max(0, Math.min(resolution - 2, Math.floor(row)));
    const col1 = col0 + 1;
    const row1 = row0 + 1;

    const fc = col - col0;
    const fr = row - row0;

    // grid is [row][col]
    const e00 = grid[row0][col0];
    const e10 = grid[row0][col1];
    const e01 = grid[row1][col0];
    const e11 = grid[row1][col1];

    return e00 * (1 - fr) * (1 - fc) +
           e10 * (1 - fr) * fc +
           e01 * fr * (1 - fc) +
           e11 * fr * fc;
  };

  const points = useMemo(() => {
    return roadCoords.map((c) => {
      const lon = c[0];
      const lat = c[1];

      const x = ((lon - minLon) / (maxLon - minLon)) * 100 - 50;
      const z = ((lat - minLat) / (maxLat - minLat)) * 100 - 50;

      const elev = sampleGrid(lat, lon);
      const y = ((elev - minE) / range) * heightScale + 0.6;

      return new THREE.Vector3(x, y, -z);
    });
  }, [roadCoords, minLat, maxLat, minLon, maxLon, minE, range, heightScale, grid]);

  const curve = useMemo(() => new THREE.CatmullRomCurve3(points), [points]);
  const tubeGeometry = useMemo(() => new THREE.TubeGeometry(curve, 200, 0.35, 8, false), [curve]);

  return (
    <mesh geometry={tubeGeometry}>
      <meshStandardMaterial
        color="#facc15"
        emissive="#facc15"
        emissiveIntensity={2}
        toneMapped={false}
      />
    </mesh>
  );
};

const Terrain3D = ({ road, onClose, elevationProfile }) => {
  const [gridData, setGridData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [heightScale, setHeightScale] = useState(30);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      const data = await fetchTerrainGrid(road.coordinates, 30);
      setGridData(data);
      setLoading(false);
    };
    loadData();
  }, [road]);

  return (
    <div className={cn(
      "fixed z-[2000] bg-zinc-950/95 backdrop-blur-3xl border border-white/10 shadow-2xl transition-all duration-500 overflow-hidden rounded-3xl",
      isFullscreen
        ? "inset-4"
        : "bottom-6 right-6 w-[460px] h-[460px]"
    )}>
      {/* Header */}
      <div className="absolute top-0 inset-x-0 p-4 flex items-center justify-between z-10 bg-gradient-to-b from-black/80 to-transparent">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-touge-500 rounded-full animate-pulse" />
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/70">3D Terrain Scan</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setIsFullscreen(!isFullscreen)} className="p-2 hover:bg-white/10 rounded-lg transition-colors text-white/50 hover:text-white">
            {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg transition-colors text-white/50 hover:text-white">
            <X size={16} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="w-full h-full flex flex-col items-center justify-center gap-4">
          <Loader2 className="w-8 h-8 text-touge-500 animate-spin" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Processing Mesh...</span>
        </div>
      ) : (
        <div className="w-full h-full">
          <Canvas shadows gl={{ antialias: true }}>
            <PerspectiveCamera makeDefault position={[80, 80, 80]} fov={45} />
            <OrbitControls
              enableDamping
              dampingFactor={0.05}
              maxPolarAngle={Math.PI / 2.1}
              minDistance={10}
              maxDistance={500}
            />

            <Stars radius={300} depth={60} count={10000} factor={7} saturation={0} fade speed={1} />
            <color attach="background" args={['#020205']} />
            <ambientLight intensity={0.5} />
            <pointLight position={[100, 150, 100]} intensity={2} castShadow />
            <spotLight position={[-100, 100, -100]} intensity={1} />

            <TerrainMesh gridData={gridData} heightScale={heightScale} />
            <RoadLine roadCoords={road.coordinates} gridData={gridData} elevationProfile={elevationProfile} heightScale={heightScale} />

            <Environment preset="city" />

            <Float speed={2} rotationIntensity={0.5} floatIntensity={0.5}>
              <Text
                position={[0, heightScale + 20, 0]}
                rotation={[0, Math.PI, 0]}
                fontSize={5}
                color="#facc15"
                anchorX="center"
                anchorY="middle"
                maxWidth={100}
                textAlign="center"
              >
                {road.name?.toUpperCase() || 'UNNAMED TOUGE'}
              </Text>
            </Float>
          </Canvas>

          {/* Bottom Controls */}
          <div className="absolute bottom-4 left-4 right-4 flex items-end gap-3 pointer-events-none">
            {/* Telemetry */}
            <div className="p-3 bg-black/60 backdrop-blur border border-white/10 rounded-xl pointer-events-none">
              <div className="text-[8px] font-bold uppercase tracking-widest text-zinc-500 mb-1">Telemetry</div>
              <div className="text-xs font-mono text-touge-400">ALT: {Math.max(...gridData.grid.flat()).toFixed(0)}m MAX</div>
              <div className="text-xs font-mono text-zinc-400">LAT: {gridData.minLat.toFixed(4)}</div>
            </div>

            {/* Height Scale Slider */}
            <div className="flex-1 p-3 bg-black/60 backdrop-blur border border-white/10 rounded-xl pointer-events-auto">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  <Mountain size={10} className="text-zinc-500" />
                  <span className="text-[8px] font-bold uppercase tracking-widest text-zinc-500">Exaggeration</span>
                </div>
                <span className="text-[10px] font-mono text-touge-400">{heightScale}×</span>
              </div>
              <input
                type="range"
                min={1}
                max={100}
                step={1}
                value={heightScale}
                onChange={(e) => setHeightScale(Number(e.target.value))}
                className="w-full h-1 appearance-none rounded-full cursor-pointer"
                style={{
                  background: `linear-gradient(to right, #f97316 0%, #f97316 ${(heightScale - 1) / 99 * 100}%, #3f3f46 ${(heightScale - 1) / 99 * 100}%, #3f3f46 100%)`
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Terrain3D;
