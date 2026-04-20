// components/AetherGateAnimation.tsx
"use client";

import React, { useRef, useMemo, memo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Effects } from "@react-three/drei";
import { UnrealBloomPass } from "three-stdlib";
import * as THREE from "three";

// ─── Extend R3F with bloom pass ────────────────────────────────────
import { extend } from "@react-three/fiber";
extend({ UnrealBloomPass });

// ─── React 19 JSX namespace fix ────────────────────────────────────
// R3F augments the old global `namespace JSX`, but React 19 / Next 15
// moved the canonical JSX types into `namespace React.JSX`.
// Re-declare the R3F primitives we use so TS stops complaining.
declare global {
  namespace React {
    namespace JSX {
      interface IntrinsicElements {
        color:         { attach?: string; args?: unknown[]; [k: string]: unknown };
        fog:           { attach?: string; args?: unknown[]; [k: string]: unknown };
        instancedMesh: { ref?: React.Ref<unknown>; args?: unknown[]; frustumCulled?: boolean; [k: string]: unknown };
      }
    }
  }
}

// ─── Constants ─────────────────────────────────────────────────────
const PARTICLE_COUNT = 18000;
const LERP_SPEED = 0.075;

// Layer thresholds (cumulative)
const L_TUNNEL = 0.28;
const L_RING = 0.40;
const L_STREAMS = 0.52;
const L_SANCTUM = 0.60;
const L_TOKENS = 0.72;
const L_MIST = 0.82;
const L_RUNIC = 0.90;
const L_DUST = 0.96;

// ─── Deterministic hash ────────────────────────────────────────────
const hash = (seed: number, mult: number): number => {
    const h = Math.sin(seed * mult) * 43758.5453;
    return h - Math.floor(h);
};

// Preallocate typed arrays for particle random values
const buildRandomTable = (count: number): Float32Array[] => {
    const tables: Float32Array[] = [];
    const multipliers = [127.1, 311.7, 74.93, 191.3, 233.7, 419.2, 547.3];
    for (const mult of multipliers) {
        const arr = new Float32Array(count);
        for (let i = 0; i < count; i++) {
            arr[i] = hash(i, mult);
        }
        tables.push(arr);
    }
    return tables;
};

// ─── Particle System ───────────────────────────────────────────────
const AetherParticles = memo(() => {
    const meshRef = useRef<THREE.InstancedMesh>(null);
    const dummy = useMemo(() => new THREE.Object3D(), []);
    const target = useMemo(() => new THREE.Vector3(), []);
    const colorObj = useMemo(() => new THREE.Color(), []);

    // Preallocate positions
    const positions = useMemo(() => {
        const arr: THREE.Vector3[] = [];
        for (let i = 0; i < PARTICLE_COUNT; i++) {
            arr.push(
                new THREE.Vector3(
                    (Math.random() - 0.5) * 100,
                    (Math.random() - 0.5) * 100,
                    (Math.random() - 0.5) * 100
                )
            );
        }
        return arr;
    }, []);

    // Precomputed random tables — avoids per-frame sin() hashing
    const randoms = useMemo(() => buildRandomTable(PARTICLE_COUNT), []);

    const geometry = useMemo(() => new THREE.SphereGeometry(0.12, 4, 3), []);
    const material = useMemo(
        () =>
            new THREE.MeshBasicMaterial({
                color: 0xffffff,
                transparent: true,
                opacity: 0.92,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
            }),
        []
    );

    useFrame((state) => {
        const mesh = meshRef.current;
        if (!mesh) return;

        const t = state.clock.getElapsedTime();
        const r1s = randoms[0];
        const r2s = randoms[1];
        const r3s = randoms[2];
        const r4s = randoms[3];
        const r5s = randoms[4];
        const r6s = randoms[5];

        const PI2 = Math.PI * 2;
        const PI = Math.PI;

        for (let i = 0; i < PARTICLE_COUNT; i++) {
            const r1 = r1s[i];
            const r2 = r2s[i];
            const r3 = r3s[i];
            const r4 = r4s[i];
            const r5 = r5s[i];
            const r6 = r6s[i];

            const layer = r4;
            let px = 0,
                py = 0,
                pz = 0;
            let hue = 0,
                sat = 0,
                lit = 0;
            let scale = 1.0;

            // ═════════════════════════════════════════════════════════
            // TUNNEL VORTEX — Blood-red swirling wormhole
            // ═════════════════════════════════════════════════════════
            if (layer < L_TUNNEL) {
                const tParam = r1 * 2.0 - 1.0;
                const tZ = tParam * 42.0;
                const absP = Math.abs(tParam);

                // Hourglass throat
                const throatR = 1.8 + absP * absP * 13.0;

                // Tight spiral near center
                const spiralTight = 3.5 + (1.0 - absP) * 10.0;
                const spiralAngle =
                    r2 * PI2 +
                    tParam * spiralTight +
                    t * (1.5 + (1.0 - absP) * 3.0);

                // Liquid scatter — closer particles clump together
                const scatter = (r3 - 0.5) * throatR * 0.18;
                const effR = throatR + scatter;

                px = Math.cos(spiralAngle) * effR;
                py = Math.sin(spiralAngle) * effR;
                pz = tZ;

                // Deep blood red at edges → bright crimson at throat
                const throatProx = 1.0 - absP;
                const pulse =
                    0.88 + Math.sin(t * 3.5 + r1 * 18.0) * 0.12;

                hue = 0.0 + throatProx * 0.02; // 0.0=red, slight shift toward orange at throat
                sat = 0.85 + throatProx * 0.1;
                lit = (0.08 + throatProx * 0.55 + r2 * 0.12) * 2.0 * pulse;
                scale = 0.5 + throatProx * 1.4;
            }

            // ═════════════════════════════════════════════════════════
            // PORTAL RINGS — Pulsing blood-red gate boundaries
            // ═════════════════════════════════════════════════════════
            else if (layer < L_RING) {
                const side = r5 < 0.5 ? 1.0 : -1.0;
                const ringZ = side * 40.0;
                const breathe = 1.0 + Math.sin(t * 1.8 + side * 1.5) * 0.07;
                const ringR = 15.0 * breathe + (r3 - 0.5) * 2.5;
                const angle = r1 * PI2 + t * 0.9 * side;

                px = Math.cos(angle) * ringR;
                py = Math.sin(angle) * ringR;
                pz = ringZ + (r2 - 0.5) * 2.0;

                const shimmer =
                    0.8 + Math.sin(t * 7.0 + angle * 4.0) * 0.2;

                // Entrance = bright scarlet, exit = dark crimson
                hue = side > 0 ? 0.0 : 0.98; // wraps around red
                sat = 0.9 + r3 * 0.1;
                lit = (0.9 + r2 * 0.7) * 2.2 * shimmer;
                scale = 0.9 + r2 * 0.9;
            }

            // ═════════════════════════════════════════════════════════
            // AETHER STREAMS — Liquid tendrils of blood flowing in
            // ═════════════════════════════════════════════════════════
            else if (layer < L_STREAMS) {
                const streamIdx = Math.floor(r5 * 5.0);
                const streamAngle = (streamIdx / 5.0) * PI2;

                const tFlow = (r1 + t * (0.12 + r6 * 0.08)) % 1.0;
                const flowZ = (1.0 - tFlow) * 85.0 - 42.5;

                const distFromCenter = Math.abs(flowZ) / 42.5;
                const streamR = 4.0 + distFromCenter * 22.0;
                const spiralA = streamAngle + tFlow * 5.0 + t * 0.25;

                // Liquid clumping — particles attract toward stream center
                const clump = Math.sin(tFlow * PI * 3.0 + r2 * PI2) * 2.0;

                px = Math.cos(spiralA) * streamR + (r2 - 0.5) * 2.5 + clump * Math.cos(spiralA);
                py = Math.sin(spiralA) * streamR + (r3 - 0.5) * 2.5 + clump * Math.sin(spiralA);
                pz = flowZ;

                const fadeIn = Math.sin(tFlow * PI);
                hue = 0.98 + r2 * 0.04; // deep blood red
                sat = 0.8 + r3 * 0.2;
                lit = fadeIn * (0.2 + r1 * 0.25) * 1.8;
                scale = 0.35 + fadeIn * 0.7;
            }

            // ═════════════════════════════════════════════════════════
            // INNER SANCTUM — Blazing core nexus
            // ═════════════════════════════════════════════════════════
            else if (layer < L_SANCTUM) {
                const sTheta = r1 * PI2 + t * 2.2;
                const sPhi = r2 * PI;
                const corePulse =
                    1.0 + Math.sin(t * 3.0) * 0.18 + Math.sin(t * 6.5) * 0.07;
                const sR = 3.0 * r3 * r3 * corePulse;

                px = Math.sin(sPhi) * Math.cos(sTheta) * sR;
                py = Math.sin(sPhi) * Math.sin(sTheta) * sR;
                pz = Math.cos(sPhi) * sR * 1.3;

                const flicker =
                    0.9 + Math.sin(t * 9.0 + r1 * 80.0) * 0.1;

                // White-hot center with crimson corona
                hue = 0.02 + r3 * 0.02;
                sat = 0.5 - r3 * 0.3; // desaturated = whiter at center
                lit = (1.5 + r3 * 1.2) * 3.2 * flicker;
                scale = 0.7 + r1 * 1.6;
            }

            // ═════════════════════════════════════════════════════════
            // TOKEN PARTICLES — Assets transiting the bridge
            // ═════════════════════════════════════════════════════════
            else if (layer < L_TOKENS) {
                const travelSpeed = 0.25 + r5 * 0.35;
                const tTravel = (r1 + t * travelSpeed) % 1.0;
                const tZ2 = (1.0 - tTravel) * 76.0 - 38.0;

                const tParam2 = tZ2 / 42.0;
                const tunnelR2 = 2.2 + Math.pow(Math.abs(tParam2), 1.8) * 11.0;

                const tokenAngle = r2 * PI2 + tTravel * 7.0 + t * 0.6;
                const tokenR = tunnelR2 * (0.25 + r3 * 0.45);

                px = Math.cos(tokenAngle) * tokenR;
                py = Math.sin(tokenAngle) * tokenR;
                pz = tZ2;

                // Bright ember / molten gold tokens
                const tokenType = Math.floor(r6 * 3.0);
                const tokenHues = [0.05, 0.08, 0.02]; // orange-red, amber, scarlet
                hue = tokenHues[tokenType];
                sat = 0.9;
                const tokenPulse =
                    0.9 + Math.sin(t * 5.0 + r2 * 25.0) * 0.1;
                lit = (0.7 + r2 * 0.5) * 2.8 * tokenPulse;
                scale = 1.1 + Math.sin(t * 3.5 + r1 * 20.0) * 0.25;
            }

            // ═════════════════════════════════════════════════════════
            // ETHEREAL MIST — Ambient blood mist / aether vapor
            // Fine particles drifting slowly like suspended liquid
            // ═════════════════════════════════════════════════════════
            else if (layer < L_MIST) {
                const mTheta = r1 * PI2;
                const mPhi = r2 * PI;
                const mR = 8.0 + r3 * 32.0;

                // Slow organic drift — like blood in zero gravity
                const driftX =
                    Math.sin(t * 0.18 + r1 * 8.0) * 2.5 +
                    Math.sin(t * 0.07 + r3 * 5.0) * 1.5;
                const driftY =
                    Math.sin(t * 0.13 + r2 * 6.0) * 2.0 +
                    Math.cos(t * 0.09 + r1 * 4.0) * 1.2;

                px = Math.sin(mPhi) * Math.cos(mTheta) * mR + driftX;
                py = Math.cos(mPhi) * mR * 0.45 + driftY;
                pz = Math.sin(mPhi) * Math.sin(mTheta) * mR * 0.7;

                const mistPulse =
                    0.65 + Math.sin(t * 1.2 + r3 * 40.0) * 0.35;

                hue = 0.98 + r1 * 0.03;
                sat = 0.6 + r2 * 0.3;
                lit = (0.015 + r3 * 0.04) * 1.4 * mistPulse;
                scale = 0.35 + r2 * 0.45;
            }

            // ═════════════════════════════════════════════════════════
            // RUNIC ORBITS — Geometric rings around the portal
            // ═════════════════════════════════════════════════════════
            else if (layer < L_RUNIC) {
                const runeRing = Math.floor(r5 * 3.0);
                const runeR = 18.0 + runeRing * 5.5;
                const runeZ = (r3 - 0.5) * 5.0;
                const dir = runeRing % 2 === 0 ? 1.0 : -1.0;
                const runeSpeed = (0.35 + runeRing * 0.12) * dir;
                const runeAngle = r1 * PI2 + t * runeSpeed;
                const runePulse = 1.0 + Math.sin(t * 2.2 + runeRing * 2.0) * 0.04;

                px = Math.cos(runeAngle) * runeR * runePulse;
                py = Math.sin(runeAngle) * runeR * runePulse;
                pz = runeZ;

                const glow =
                    0.6 + Math.sin(t * 6.0 + runeAngle * 6.0) * 0.4;

                hue = 0.0 + runeRing * 0.015; // slight hue shift per ring
                sat = 0.75 + r2 * 0.2;
                lit = (0.1 + r2 * 0.15) * 1.8 * glow;
                scale = 0.25 + glow * 0.35;
            }

            // ═════════════════════════════════════════════════════════
            // COSMIC DUST & DISTANT STARS
            // ═════════════════════════════════════════════════════════
            else {
                const isDeepStar = r6 > 0.5;
                const dTheta = r1 * PI2;
                const dPhi = r2 * PI;
                const dR = isDeepStar ? 55.0 + r3 * 45.0 : 35.0 + r3 * 25.0;

                px = Math.sin(dPhi) * Math.cos(dTheta) * dR;
                py = Math.cos(dPhi) * dR * (isDeepStar ? 1.0 : 0.35);
                pz = Math.sin(dPhi) * Math.sin(dTheta) * dR;

                if (isDeepStar) {
                    const twinkle = Math.abs(
                        Math.sin(t * (1.5 + r3 * 7.0) + r1 * 400.0)
                    );
                    hue = 0.0;
                    sat = 0.15 + r3 * 0.2;
                    lit = (0.03 + twinkle * 0.18) * 1.2;
                    scale = 0.15 + twinkle * 0.3;
                } else {
                    hue = 0.97 + r1 * 0.04;
                    sat = 0.5 + r2 * 0.3;
                    lit = (0.008 + r3 * 0.02) * 1.0;
                    scale = 0.25 + r1 * 0.25;
                }
            }

            target.set(px, py, pz);
            colorObj.setHSL(hue % 1.0, Math.min(sat, 1.0), Math.max(lit, 0));

            positions[i].lerp(target, LERP_SPEED);
            dummy.position.copy(positions[i]);
            dummy.scale.setScalar(scale);
            dummy.updateMatrix();
            mesh.setMatrixAt(i, dummy.matrix);
            mesh.setColorAt(i, colorObj);
        }

        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    });

    return <instancedMesh ref={meshRef} args={[geometry, material, PARTICLE_COUNT]} frustumCulled={false} />;
});

AetherParticles.displayName = "AetherParticles";

// ─── Scene wrapper ─────────────────────────────────────────────────
const AetherScene = memo(() => (
    <>
        <color attach="background" args={["#050000"]} />
        <fog attach="fog" args={["#050000", 65, 125]} />
        <AetherParticles />
        <OrbitControls
            autoRotate
            autoRotateSpeed={0.25}
            enableZoom={false}
            enablePan={false}
            maxPolarAngle={Math.PI * 0.68}
            minPolarAngle={Math.PI * 0.32}
        />
        <Effects disableGamma>
            {/* @ts-expect-error — r3f extend typing */}
            <unrealBloomPass threshold={0.02} strength={2.4} radius={0.55} />
        </Effects>
    </>
));

AetherScene.displayName = "AetherScene";

// ─── Exported Component ────────────────────────────────────────────
export interface AetherGateAnimationProps {
    className?: string;
    style?: React.CSSProperties;
}

const AetherGateAnimation: React.FC<AetherGateAnimationProps> = ({
    className,
    style,
}) => {
    return (
        <div
            className={className}
            style={{
                width: "100%",
                height: "100%",
                background: "#050000",
                ...style,
            }}
        >
            <Canvas
                camera={{ position: [0, 6, 52], fov: 62 }}
                dpr={[1, 1.5]}
                performance={{ min: 0.5 }}
                gl={{
                    antialias: false,
                    alpha: false,
                    powerPreference: "high-performance",
                    stencil: false,
                    depth: true,
                }}
            >
                <AetherScene />
            </Canvas>
        </div>
    );
};

export default memo(AetherGateAnimation);