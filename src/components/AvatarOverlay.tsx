import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { useEffect, useRef, Suspense, useState } from 'react';
import type { MutableRefObject } from 'react';
import * as THREE from 'three';
import type { FaceBox, FaceSnapshot, FrameSize } from '../types/face';
import { computeFaceBox } from '../utils/face';

function CameraSync() {
    const { camera, size } = useThree();
    useEffect(() => {
        if (camera instanceof THREE.OrthographicCamera) {
            camera.left = -size.width / 2;
            camera.right = size.width / 2;
            camera.top = size.height / 2;
            camera.bottom = -size.height / 2;
            camera.near = -1000;
            camera.far = 1000;
            camera.updateProjectionMatrix();
        }
    }, [camera, size]);
    return null;
}

function RenderTick({
    snapshotRef,
    enabled,
}: {
    snapshotRef: MutableRefObject<FaceSnapshot | null>;
    enabled: boolean;
}) {
    const { invalidate } = useThree();

    useEffect(() => {
        if (!enabled) {
            return;
        }
        const intervalId = window.setInterval(() => {
            invalidate();
        }, 16);

        return () => window.clearInterval(intervalId);
    }, [enabled, invalidate]);

    useEffect(() => {
        if (enabled) {
            invalidate();
        }
    }, [enabled, invalidate]);

    return null;
}

function AvatarModel({
    snapshotRef,
    frameSizeRef,
    headScale,
    mirror,
    enabled,
}: {
    snapshotRef: MutableRefObject<FaceSnapshot | null>;
    frameSizeRef: MutableRefObject<FrameSize>;
    headScale: number;
    mirror: boolean;
    enabled: boolean;
}) {
    const { scene } = useGLTF('/raccoon_head.glb');
    const groupRef = useRef<THREE.Group>(null);
    const modelRef = useRef<THREE.Object3D | null>(null);
    const morphTargetMeshRef = useRef<THREE.Mesh | null>(null);
    const { size } = useThree();
    const rotationMatrixRef = useRef(new THREE.Matrix4());
    const mpMatrixRef = useRef(new THREE.Matrix4());
    const mirrorMatrixRef = useRef(new THREE.Matrix4().makeScale(-1, 1, 1));
    const targetQuatRef = useRef(new THREE.Quaternion());
    const smoothQuatRef = useRef(new THREE.Quaternion());
    const hasRotationRef = useRef(false);
    const blendshapeStateRef = useRef<Record<string, number>>({});
    const lastFaceBoxRef = useRef<FaceBox | null>(null);
    const lastFaceBoxTimeRef = useRef(0);
    const smoothPositionRef = useRef(new THREE.Vector3());
    const smoothScaleRef = useRef(1);
    const hasPositionRef = useRef(false);

    const rotationSmoothing = 12;
    const positionSmoothing = 12;
    const scaleSmoothing = 10;
    const blendshapeSmoothing = 0.25;
    const eyeLookSmoothing = 0.15;
    const eyeLookScale = 0.4;
    const faceBoxHoldMs = 1500;
    const avatarPadX = 0.28;
    const avatarPadY = 0.55;
    const avatarShiftY = 0.45;
    const avatarOffsetY = 0.08;

    // Find the mesh with morph targets
    useEffect(() => {
        scene.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
                const mesh = child as THREE.Mesh;
                if (mesh.morphTargetDictionary) {
                    morphTargetMeshRef.current = mesh;
                }
                if (Array.isArray(mesh.material)) {
                    mesh.material.forEach((material) => {
                        material.side = THREE.DoubleSide;
                    });
                } else if (mesh.material) {
                    mesh.material.side = THREE.DoubleSide;
                }
                mesh.frustumCulled = false;
            }
        });
    }, [scene]);

    // Center + normalize model size for face matrix alignment.
    useEffect(() => {
        const model = modelRef.current;
        if (!model) return;

        const box = new THREE.Box3().setFromObject(model);
        const center = new THREE.Vector3();
        box.getCenter(center);
        model.position.sub(center);

        const size = new THREE.Vector3();
        box.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z);
        if (maxDim > 0) {
            const target = 1.0;
            const scale = target / maxDim;
            model.scale.setScalar(scale);
        }
    }, [scene]);

    useFrame((_, delta) => {
        if (!enabled) {
            if (groupRef.current) {
                groupRef.current.visible = false;
            }
            return;
        }
        const now = performance.now();
        const frame = frameSizeRef.current;
        const snapshot = snapshotRef.current;
        let latestFaceBox: FaceBox | null = null;
        if (snapshot && snapshot.landmarks.length > 0 && frame.width && frame.height) {
            latestFaceBox = computeFaceBox(
                snapshot.landmarks,
                frame.width,
                frame.height,
                avatarPadX,
                avatarPadY,
                avatarShiftY,
                mirror
            );
        }
        if (latestFaceBox) {
            lastFaceBoxRef.current = latestFaceBox;
            lastFaceBoxTimeRef.current = now;
        }
        const faceBox = latestFaceBox ?? (
            lastFaceBoxRef.current && now - lastFaceBoxTimeRef.current < faceBoxHoldMs
                ? lastFaceBoxRef.current
                : null
        );
        if (!groupRef.current || !faceBox || !frame.width || !frame.height) {
            if (groupRef.current) groupRef.current.visible = false;
            return;
        }

        const scaleX = size.width / frame.width;
        const scaleY = size.height / frame.height;
        const boxCenterX = (faceBox.x + faceBox.width * 0.5) * scaleX;
        const boxCenterY = (faceBox.y + faceBox.height * 0.5) * scaleY;
        const posX = boxCenterX - size.width * 0.5;
        const posY = size.height * 0.5 - boxCenterY + faceBox.height * scaleY * avatarOffsetY;
        const boxScale = Math.max(faceBox.width * scaleX, faceBox.height * scaleY) * headScale;

        groupRef.current.visible = true;
        const targetPos = new THREE.Vector3(posX, posY, 0);
        if (!hasPositionRef.current) {
            smoothPositionRef.current.copy(targetPos);
            smoothScaleRef.current = boxScale;
            hasPositionRef.current = true;
        } else {
            const alpha = 1 - Math.exp(-positionSmoothing * delta);
            smoothPositionRef.current.lerp(targetPos, alpha);
            smoothScaleRef.current = THREE.MathUtils.damp(smoothScaleRef.current, boxScale, scaleSmoothing, delta);
        }
        groupRef.current.position.copy(smoothPositionRef.current);
        groupRef.current.scale.setScalar(smoothScaleRef.current);

        const matrixData = snapshot?.matrix;
        let hasValidMatrix = false;
        if (matrixData && typeof matrixData.length === 'number' && matrixData.length >= 16) {
            hasValidMatrix = true;
            for (let idx = 0; idx < 16; idx += 1) {
                const value = (matrixData as ArrayLike<number>)[idx];
                if (!Number.isFinite(value)) {
                    hasValidMatrix = false;
                    break;
                }
            }
        }
        if (hasValidMatrix) {
            const mpMatrix = mpMatrixRef.current;
            const rotationMatrix = rotationMatrixRef.current;
            mpMatrix.fromArray(matrixData as number[]);
            rotationMatrix.extractRotation(mpMatrix);

            if (mirror) {
                const mirrorMatrix = mirrorMatrixRef.current;
                rotationMatrix.premultiply(mirrorMatrix).multiply(mirrorMatrix);
            }

            const targetQuat = targetQuatRef.current.setFromRotationMatrix(rotationMatrix);
            const smoothQuat = smoothQuatRef.current;
            if (!hasRotationRef.current) {
                smoothQuat.copy(targetQuat);
                hasRotationRef.current = true;
            } else {
                const alpha = 1 - Math.exp(-rotationSmoothing * delta);
                smoothQuat.slerp(targetQuat, alpha);
            }
            groupRef.current.quaternion.copy(smoothQuat);
        }

        // Apply Blendshapes
        if (snapshot?.blendshapes && snapshot.blendshapes.length > 0 && morphTargetMeshRef.current) {
            const mesh = morphTargetMeshRef.current;
            const shapes = snapshot.blendshapes;

            shapes.forEach((shape) => {
                // MediaPipe shape names like "jawOpen", "eyeBlinkLeft"
                // GLB usually has specific names. We rely on the GLB having matching names
                // or standard ARKit names.
                const index = mesh.morphTargetDictionary?.[shape.name];
                if (index !== undefined && mesh.morphTargetInfluences) {
                    const isEyeLook = shape.name.startsWith('eyeLook');
                    const smooth = isEyeLook ? eyeLookSmoothing : blendshapeSmoothing;
                    const target = (isEyeLook ? shape.score * eyeLookScale : shape.score);
                    const prev = blendshapeStateRef.current[shape.name] ?? 0;
                    const next = THREE.MathUtils.lerp(prev, target, smooth);
                    blendshapeStateRef.current[shape.name] = next;
                    mesh.morphTargetInfluences[index] = Math.min(1, Math.max(0, next));
                }
            });
        }
    });

    return (
        <group ref={groupRef}>
            <primitive object={scene} ref={modelRef} dispose={null} />
        </group>
    );
}

export function AvatarOverlay({
    snapshotRef,
    frameSizeRef,
    headScale,
    mirror,
    enabled,
    renderQuality,
}: {
    snapshotRef: MutableRefObject<FaceSnapshot | null>;
    frameSizeRef: MutableRefObject<FrameSize>;
    headScale: number;
    mirror: boolean;
    enabled: boolean;
    renderQuality: number;
}) {
    const [rendererKey, setRendererKey] = useState(0);
    const dpr = Math.min(1.5, Math.max(0.8, renderQuality));

    return (
        <div className="absolute inset-0 pointer-events-none">
            <Canvas
                key={rendererKey}
                orthographic
                camera={{ position: [0, 0, 10], zoom: 1 }}
                frameloop="demand"
                dpr={dpr}
                gl={{ alpha: true, antialias: false, powerPreference: 'high-performance' }}
                onCreated={({ gl }) => {
                    gl.setClearColor(0x000000, 0);
                    const canvas = gl.domElement;
                    canvas.addEventListener('webglcontextlost', (event) => {
                        event.preventDefault();
                        window.setTimeout(() => {
                            setRendererKey((key) => key + 1);
                        }, 250);
                    }, { passive: false });
                }}
                style={{ pointerEvents: 'none', width: '100%', height: '100%' }}
            >
                <CameraSync />
                <RenderTick snapshotRef={snapshotRef} enabled={enabled} />
                <ambientLight intensity={1.5} />
                <directionalLight position={[0, 0, 5]} intensity={2} />
                <Suspense fallback={null}>
                    <AvatarModel
                        snapshotRef={snapshotRef}
                        frameSizeRef={frameSizeRef}
                        headScale={headScale}
                        mirror={mirror}
                        enabled={enabled}
                    />
                </Suspense>
            </Canvas>
        </div>
    );
}

// Pre-load removed to avoid top-level suspense issues
// useGLTF.preload('/raccoon_head.glb');
