import { useEffect, useRef, useState, useCallback, type MutableRefObject } from 'react';
import { useCamera } from '../hooks/useCamera';
import { MediaPipeService } from '../services/MediaPipeService';
import { ImageSegmenterResult, type FaceLandmarkerResult } from '@mediapipe/tasks-vision';
import type { FaceBox, FrameSize, FaceSnapshot } from '../types/face';
import { computeFaceBox } from '../utils/face';
import { AvatarOverlay } from './AvatarOverlay';
import { Settings, User, Image as ImageIcon, ExternalLink, Box, FlipHorizontal, Cpu, Monitor } from 'lucide-react';

export function CameraProcessor() {
    const { videoRef, error } = useCamera();
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const personCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const faceBoxRef = useRef<FaceBox | null>(null);
    const frameSizeRef = useRef<FrameSize>({ width: 0, height: 0 });
    const [isInitializing, setIsInitializing] = useState(true);
    const [initError, setInitError] = useState<string | null>(null);
    const [enableFaceSwap, setEnableFaceSwap] = useState(false);
    const [enable3DAvatar, setEnable3DAvatar] = useState(false); // Default to false to prevent crash on load
    const [enableBackgroundReplace, setEnableBackgroundReplace] = useState(false);
    const [headScale, setHeadScale] = useState(1.15);
    const [mirrorCamera, setMirrorCamera] = useState(true);
    const [has3DInitialized, setHas3DInitialized] = useState(false);
    const [renderQuality, setRenderQuality] = useState(1.25);
    const [cleanMode, setCleanMode] = useState(false);
    const [renderMode, setRenderMode] = useState<'cpu' | 'gpu'>(() => {
        if (typeof window !== 'undefined') {
            try {
                const stored = window.localStorage.getItem('renderMode');
                if (stored === 'cpu' || stored === 'gpu') {
                    return stored;
                }
            } catch {
                // Ignore storage access errors.
            }
        }
        return 'cpu';
    });
    const [needsRestart, setNeedsRestart] = useState(false);
    const [allowGpuFallback, setAllowGpuFallback] = useState(true);
    const [gpuBackend, setGpuBackend] = useState<'d3d11' | 'd3d9' | 'opengl' | 'vulkan' | 'desktop'>('d3d11');
    const [ignoreGpuBlocklist, setIgnoreGpuBlocklist] = useState(false);
    const [disableGpuSandbox, setDisableGpuSandbox] = useState(false);
    const [preventMinimizeForObs, setPreventMinimizeForObs] = useState(true);

    // Ref to pass data to 3D scene without re-renders
    const faceSnapshotRef = useRef<FaceSnapshot | null>(null);
    const lastVideoTimeRef = useRef(-1);
    // Assets
    const [backgroundImage, setBackgroundImage] = useState<HTMLImageElement | null>(null);
    const [faceOverlayImage, setFaceOverlayImage] = useState<HTMLImageElement | null>(null);
    const lastFaceResultTimeRef = useRef(0);
    const faceHoldMs = 600;

    useEffect(() => {
        if (enable3DAvatar && !has3DInitialized) {
            setHas3DInitialized(true);
        }
    }, [enable3DAvatar, has3DInitialized]);

    useEffect(() => {
        let active = true;
        const ipc = window.ipcRenderer;
        if (!ipc?.invoke) {
            return () => {
                active = false;
            };
        }
        ipc.invoke('app:get-render-mode')
            .then((mode) => {
                if (!active) return;
                if (mode === 'cpu' || mode === 'gpu') {
                    setRenderMode(mode);
                    try {
                        window.localStorage.setItem('renderMode', mode);
                    } catch {
                        // Ignore storage access errors.
                    }
                }
            })
            .catch((error) => {
                console.warn('Failed to read render mode:', error);
            });
        ipc.invoke('app:get-gpu-fallback')
            .then((value) => {
                if (!active) return;
                if (typeof value === 'boolean') {
                    setAllowGpuFallback(value);
                }
            })
            .catch((error) => {
                console.warn('Failed to read GPU fallback mode:', error);
            });
        ipc.invoke('app:get-gpu-backend')
            .then((value) => {
                if (!active) return;
                if (value === 'd3d11' || value === 'd3d9' || value === 'opengl' || value === 'vulkan' || value === 'desktop') {
                    setGpuBackend(value);
                }
            })
            .catch((error) => {
                console.warn('Failed to read GPU backend:', error);
            });
        ipc.invoke('app:get-ignore-gpu-blocklist')
            .then((value) => {
                if (!active) return;
                if (typeof value === 'boolean') {
                    setIgnoreGpuBlocklist(value);
                }
            })
            .catch((error) => {
                console.warn('Failed to read ignore blocklist:', error);
            });
        ipc.invoke('app:get-disable-gpu-sandbox')
            .then((value) => {
                if (!active) return;
                if (typeof value === 'boolean') {
                    setDisableGpuSandbox(value);
                }
            })
            .catch((error) => {
                console.warn('Failed to read GPU sandbox setting:', error);
            });
        ipc.invoke('app:get-prevent-minimize')
            .then((value) => {
                if (!active) return;
                if (typeof value === 'boolean') {
                    setPreventMinimizeForObs(value);
                }
            })
            .catch((error) => {
                console.warn('Failed to read minimize behavior:', error);
            });
        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        const handleVisible = () => {
            if (document.visibilityState === 'visible') {
                lastVideoTimeRef.current = -1;
                const video = videoRef.current;
                if (video && video.paused) {
                    video.play().catch(() => {
                        // Ignore play errors when resuming.
                    });
                }
            }
        };
        document.addEventListener('visibilitychange', handleVisible);
        window.addEventListener('focus', handleVisible);
        return () => {
            document.removeEventListener('visibilitychange', handleVisible);
            window.removeEventListener('focus', handleVisible);
        };
    }, [videoRef]);

    useEffect(() => {
        try {
            window.localStorage.setItem('renderMode', renderMode);
        } catch {
            // Ignore storage access errors.
        }
    }, [renderMode]);

    useEffect(() => {
        let active = true;
        MediaPipeService.getInstance()
            .initialize()
            .then(() => {
                if (!active) return;
                setIsInitializing(false);
            })
            .catch((err) => {
                if (!active) return;
                console.error("Failed to initialize MediaPipe:", err);
                setIsInitializing(false);
                setInitError(err instanceof Error ? err.message : String(err));
            });
        return () => {
            active = false;
        };
    }, []);

    const drawComposition = useCallback((
        ctx: CanvasRenderingContext2D,
        video: HTMLVideoElement,
        canvas: HTMLCanvasElement,
        segmentation: ImageSegmenterResult | null,
        snapshot: FaceSnapshot | null
    ) => {
        const ensureCanvas = (ref: MutableRefObject<HTMLCanvasElement | null>, width: number, height: number) => {
            if (!ref.current) {
                ref.current = document.createElement('canvas');
            }
            if (ref.current.width !== width || ref.current.height !== height) {
                ref.current.width = width;
                ref.current.height = height;
            }
            return ref.current;
        };

        ctx.save();
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Mirror Effect
        if (mirrorCamera) {
            ctx.scale(-1, 1);
            ctx.translate(-canvas.width, 0);
        }

        // --- Background Layer ---
        if (enableBackgroundReplace && (segmentation?.confidenceMasks?.length || segmentation?.categoryMask)) {
            const mask = segmentation.confidenceMasks?.[0] ?? segmentation.categoryMask!;
            const isConfidenceMask = Boolean(segmentation.confidenceMasks?.length);
            const maskWidth = mask.width;
            const maskHeight = mask.height;
            const maskCanvas = ensureCanvas(maskCanvasRef, maskWidth, maskHeight);
            const personCanvas = ensureCanvas(personCanvasRef, canvas.width, canvas.height);
            const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
            const personCtx = personCanvas.getContext('2d', { willReadFrequently: true });

            if (maskCtx && personCtx) {
                const maskData = isConfidenceMask ? mask.getAsFloat32Array() : mask.getAsUint8Array();
                const imageData = maskCtx.createImageData(maskWidth, maskHeight);
                const data = imageData.data;
                for (let i = 0; i < maskData.length; i++) {
                    const value = maskData[i];
                    const alpha = isConfidenceMask ? Math.round(Math.min(1, Math.max(0, value)) * 255) : (value > 0 ? 255 : 0);
                    const idx = i * 4;
                    data[idx] = 255;
                    data[idx + 1] = 255;
                    data[idx + 2] = 255;
                    data[idx + 3] = alpha;
                }
                maskCtx.putImageData(imageData, 0, 0);

                if (backgroundImage) {
                    ctx.drawImage(backgroundImage, 0, 0, canvas.width, canvas.height);
                } else {
                    ctx.save();
                    ctx.filter = 'blur(12px)';
                    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                    ctx.restore();
                }

                personCtx.clearRect(0, 0, personCanvas.width, personCanvas.height);
                personCtx.drawImage(video, 0, 0, personCanvas.width, personCanvas.height);
                personCtx.globalCompositeOperation = 'destination-in';
                personCtx.drawImage(maskCanvas, 0, 0, personCanvas.width, personCanvas.height);
                personCtx.globalCompositeOperation = 'source-over';
                ctx.drawImage(personCanvas, 0, 0, canvas.width, canvas.height);
            } else {
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            }
            segmentation.close();
        } else {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        }

        // --- Face Layer ---
        let faceBox: FaceBox | null = null;
        if (snapshot && snapshot.landmarks.length > 0) {
            faceBox = computeFaceBox(
                snapshot.landmarks,
                canvas.width,
                canvas.height,
                0.2,
                0.4,
                0.3,
                mirrorCamera
            );
            faceBoxRef.current = faceBox;
        } else {
            faceBoxRef.current = null;
        }

        if (enableFaceSwap && faceBox) {
            if (faceOverlayImage) {
                ctx.drawImage(faceOverlayImage, faceBox.x, faceBox.y, faceBox.width, faceBox.height);
            } else if (snapshot) {
                const landmarks = snapshot.landmarks;
                // Debug Landmarks
                ctx.fillStyle = 'rgba(0, 255, 0, 0.5)';
                for (const landmark of landmarks) {
                    ctx.beginPath();
                    ctx.arc(landmark.x * canvas.width, landmark.y * canvas.height, 1.5, 0, 2 * Math.PI);
                    ctx.fill();
                }
            }
        }

        ctx.restore();
    }, [enableBackgroundReplace, backgroundImage, enableFaceSwap, faceOverlayImage, mirrorCamera]);

    const buildFaceSnapshot = (result: FaceLandmarkerResult, timestamp: number): FaceSnapshot | null => {
        if (!result.faceLandmarks || result.faceLandmarks.length === 0) {
            return null;
        }
        const landmarks = result.faceLandmarks[0].map((landmark) => ({
            x: landmark.x,
            y: landmark.y,
            z: landmark.z,
        }));

        let matrix: number[] | undefined;
        const rawMatrix = result.facialTransformationMatrixes?.[0];
        const rawData = Array.isArray(rawMatrix)
            ? rawMatrix
            : rawMatrix && typeof rawMatrix === 'object' && 'data' in rawMatrix
                ? (rawMatrix as { data: number[] }).data
                : undefined;
        if (rawData && rawData.length >= 16) {
            matrix = Array.from(rawData.slice(0, 16));
        }

        const blendshapes = result.faceBlendshapes?.[0]?.categories?.map((category) => ({
            name: category.categoryName,
            score: category.score,
        }));

        return {
            landmarks,
            matrix,
            blendshapes,
            timestamp,
        };
    };

    useEffect(() => {
        let animationFrameId: number;

        const renderLoop = () => {
            const video = videoRef.current;
            const canvas = canvasRef.current;

            if (video && canvas && video.readyState >= 2 && !isInitializing && !initError) {
                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                if (ctx) {
                    if (video.videoWidth > 0 && video.videoHeight > 0
                        && (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight)
                    ) {
                        canvas.width = video.videoWidth;
                        canvas.height = video.videoHeight;
                    }
                    frameSizeRef.current = { width: canvas.width, height: canvas.height };

                    if (video.currentTime !== lastVideoTimeRef.current) {
                        lastVideoTimeRef.current = video.currentTime;
                        const startTimeMs = performance.now();
                        const service = MediaPipeService.getInstance();

                        let faceResult: FaceLandmarkerResult | null = null;
                        if (enableFaceSwap || enable3DAvatar) {
                            faceResult = service.detectFace(video, startTimeMs);
                        }
                        const snapshot = faceResult ? buildFaceSnapshot(faceResult, startTimeMs) : null;
                        if (snapshot) {
                            faceSnapshotRef.current = snapshot;
                            lastFaceResultTimeRef.current = startTimeMs;
                        } else if (
                            faceSnapshotRef.current
                            && !enable3DAvatar
                            && startTimeMs - lastFaceResultTimeRef.current > faceHoldMs
                        ) {
                            faceSnapshotRef.current = null;
                        }
                        const activeSnapshot = faceSnapshotRef.current;

                        if (enableBackgroundReplace) {
                            service.segmentImage(video, startTimeMs, (result) => {
                                drawComposition(ctx, video, canvas, result, activeSnapshot);
                            });
                        } else {
                            drawComposition(ctx, video, canvas, null, activeSnapshot);
                        }
                    }
                }
            } else if (video && canvas && isInitializing) {
                const ctx = canvas.getContext('2d');
                if (ctx) {
                    ctx.fillStyle = '#111';
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                }
            }

            animationFrameId = requestAnimationFrame(renderLoop);
        };

        renderLoop();
        return () => cancelAnimationFrame(animationFrameId);
    }, [videoRef, isInitializing, initError, enableFaceSwap, enableBackgroundReplace, enable3DAvatar, drawComposition]); // Added enable3DAvatar dependency

    const handleBgUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const img = new Image();
            img.src = URL.createObjectURL(e.target.files[0]);
            img.onload = () => setBackgroundImage(img);
        }
    };

    const handleRenderModeToggle = async () => {
        const nextMode = renderMode === 'gpu' ? 'cpu' : 'gpu';
        setRenderMode(nextMode);
        try {
            window.localStorage.setItem('renderMode', nextMode);
        } catch {
            // Ignore storage access errors.
        }
        if (window.ipcRenderer?.invoke) {
            const ok = await window.ipcRenderer.invoke('app:set-render-mode', nextMode);
            if (ok) {
                setNeedsRestart(true);
            }
        }
    };

    const handleFallbackToggle = async () => {
        const nextValue = !allowGpuFallback;
        setAllowGpuFallback(nextValue);
        if (window.ipcRenderer?.invoke) {
            const ok = await window.ipcRenderer.invoke('app:set-gpu-fallback', nextValue);
            if (ok) {
                setNeedsRestart(true);
            }
        }
    };

    const handleBackendChange = async (backend: 'd3d11' | 'd3d9' | 'opengl' | 'vulkan' | 'desktop') => {
        setGpuBackend(backend);
        if (window.ipcRenderer?.invoke) {
            const ok = await window.ipcRenderer.invoke('app:set-gpu-backend', backend);
            if (ok) {
                setNeedsRestart(true);
            }
        }
    };

    const handleIgnoreBlocklistToggle = async () => {
        const nextValue = !ignoreGpuBlocklist;
        setIgnoreGpuBlocklist(nextValue);
        if (window.ipcRenderer?.invoke) {
            const ok = await window.ipcRenderer.invoke('app:set-ignore-gpu-blocklist', nextValue);
            if (ok) {
                setNeedsRestart(true);
            }
        }
    };

    const handleDisableGpuSandboxToggle = async () => {
        const nextValue = !disableGpuSandbox;
        setDisableGpuSandbox(nextValue);
        if (window.ipcRenderer?.invoke) {
            const ok = await window.ipcRenderer.invoke('app:set-disable-gpu-sandbox', nextValue);
            if (ok) {
                setNeedsRestart(true);
            }
        }
    };

    const handlePreventMinimizeToggle = async () => {
        const nextValue = !preventMinimizeForObs;
        setPreventMinimizeForObs(nextValue);
        if (window.ipcRenderer?.invoke) {
            const ok = await window.ipcRenderer.invoke('app:set-prevent-minimize', nextValue);
            if (!ok) {
                setPreventMinimizeForObs((current) => !current);
            }
        }
    };

    const handleRestart = () => {
        window.ipcRenderer?.send?.('app:relaunch');
    };

    const handleFaceUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const img = new Image();
            img.src = URL.createObjectURL(e.target.files[0]);
            img.onload = () => setFaceOverlayImage(img);
        }
    };

    const handleClearBg = () => {
        setBackgroundImage(null);
    };

    if (error) return <div className="text-red-500">{error}</div>;

    const canRelaunch = Boolean(window.ipcRenderer?.send);

    // Layout and UI
    return (
        <div className="flex h-full w-full overflow-hidden bg-black">
            {/* LEFT: Main Preview Area */}
            <div className={`flex-1 relative flex items-center justify-center bg-black overflow-hidden ${cleanMode ? 'p-0' : 'p-4'}`}>
                <div className={`relative w-full max-w-full max-h-full aspect-video border border-gray-800 rounded-lg overflow-hidden shadow-2xl ring-1 ring-white/10 ${cleanMode ? 'rounded-none border-0 ring-0' : ''}`}>
                    <video ref={videoRef} className="absolute opacity-0 pointer-events-none" playsInline muted autoPlay />
                    <canvas ref={canvasRef} className="w-full h-full object-contain" />

                    {/* 3D Avatar Overlay */}
                    {has3DInitialized && (
                        <div className={`absolute inset-0 pointer-events-none ${enable3DAvatar ? 'opacity-100' : 'opacity-0'}`}>
                            <AvatarOverlay
                                snapshotRef={faceSnapshotRef}
                                frameSizeRef={frameSizeRef}
                                headScale={headScale}
                                mirror={mirrorCamera}
                                enabled={enable3DAvatar}
                                renderQuality={renderQuality}
                            />
                        </div>
                    )}

                    {isInitializing && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-20">
                            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
                            <span className="ml-3 text-white font-medium">Loading AI Models...</span>
                        </div>
                    )}
                    {initError && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-20">
                            <div className="max-w-sm text-center text-red-300">
                                <div className="text-sm font-semibold">AI model failed to load</div>
                                <div className="mt-2 text-xs text-red-200/80">{initError}</div>
                            </div>
                        </div>
                    )}

                    {cleanMode && (
                        <button
                            onClick={() => setCleanMode(false)}
                            className="absolute right-3 top-3 rounded-full bg-black/60 text-white/80 px-3 py-1 text-xs border border-white/20 hover:bg-black/80 hover:text-white transition-opacity opacity-70 hover:opacity-100"
                        >
                            Exit Clean Mode
                        </button>
                    )}
                </div>
            </div>

            {/* RIGHT: Sidebar Controls */}
            {!cleanMode && (
                <div className="w-80 flex-shrink-0 bg-gray-800 border-l border-gray-700 p-6 flex flex-col gap-6 overflow-y-auto">
                <div>
                    <h1 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
                        Face Swap Studio
                    </h1>
                    <p className="text-xs text-gray-400 mt-1">Virtual Camera Controller</p>
                </div>

                {/* Section: Camera */}
                <div className="space-y-3">
                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Camera</div>

                    <button
                        onClick={() => setMirrorCamera((current) => !current)}
                        className={`w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all border ${mirrorCamera
                            ? 'bg-sky-600/20 border-sky-500/50 text-sky-200'
                            : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-750'
                            }`}
                    >
                        <div className="flex items-center gap-3">
                            <FlipHorizontal size={20} />
                            <span>Flip Camera</span>
                        </div>
                        <div className={`w-2 h-2 rounded-full ${mirrorCamera ? 'bg-sky-400' : 'bg-gray-600'}`} />
                    </button>
                </div>

                {/* Section: Performance */}
                <div className="space-y-3">
                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Performance</div>

                    <button
                        onClick={handleRenderModeToggle}
                        className={`w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all border ${renderMode === 'gpu'
                            ? 'bg-emerald-600/20 border-emerald-500/50 text-emerald-200'
                            : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-750'
                            }`}
                    >
                        <div className="flex items-center gap-3">
                            <Cpu size={20} />
                            <span>GPU Mode</span>
                        </div>
                        <div className={`w-2 h-2 rounded-full ${renderMode === 'gpu' ? 'bg-emerald-400' : 'bg-gray-600'}`} />
                    </button>

                    <button
                        onClick={handleFallbackToggle}
                        className={`w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all border ${allowGpuFallback
                            ? 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-750'
                            : 'bg-amber-600/20 border-amber-500/50 text-amber-200'
                            }`}
                    >
                        <div className="flex items-center gap-3">
                            <Settings size={20} />
                            <span>Auto Fallback</span>
                        </div>
                        <div className={`w-2 h-2 rounded-full ${allowGpuFallback ? 'bg-gray-600' : 'bg-amber-400'}`} />
                    </button>

                    <div className="space-y-2 text-xs text-gray-400">
                        <div className="flex items-center justify-between">
                            <span>GPU Backend</span>
                            <span className="text-gray-500">{gpuBackend.toUpperCase()}</span>
                        </div>
                        <select
                            value={gpuBackend}
                            onChange={(e) => handleBackendChange(e.target.value as 'd3d11' | 'd3d9' | 'opengl' | 'vulkan' | 'desktop')}
                            className="w-full rounded-lg border border-gray-700 bg-gray-900 px-2 py-2 text-xs text-gray-200"
                        >
                            <option value="d3d11">D3D11 (ANGLE)</option>
                            <option value="d3d9">D3D9 (ANGLE)</option>
                            <option value="opengl">OpenGL (ANGLE)</option>
                            <option value="vulkan">Vulkan (ANGLE)</option>
                            <option value="desktop">Desktop OpenGL</option>
                        </select>
                    </div>

                    <button
                        onClick={handleIgnoreBlocklistToggle}
                        className={`w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all border ${ignoreGpuBlocklist
                            ? 'bg-amber-600/20 border-amber-500/50 text-amber-200'
                            : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-750'
                            }`}
                    >
                        <div className="flex items-center gap-3">
                            <Settings size={20} />
                            <span>Ignore Blocklist</span>
                        </div>
                        <div className={`w-2 h-2 rounded-full ${ignoreGpuBlocklist ? 'bg-amber-400' : 'bg-gray-600'}`} />
                    </button>

                    <button
                        onClick={handleDisableGpuSandboxToggle}
                        className={`w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all border ${disableGpuSandbox
                            ? 'bg-amber-600/20 border-amber-500/50 text-amber-200'
                            : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-750'
                            }`}
                    >
                        <div className="flex items-center gap-3">
                            <Settings size={20} />
                            <span>Disable GPU Sandbox</span>
                        </div>
                        <div className={`w-2 h-2 rounded-full ${disableGpuSandbox ? 'bg-amber-400' : 'bg-gray-600'}`} />
                    </button>

                    <button
                        onClick={handlePreventMinimizeToggle}
                        className={`w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all border ${preventMinimizeForObs
                            ? 'bg-sky-600/20 border-sky-500/50 text-sky-200'
                            : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-750'
                            }`}
                    >
                        <div className="flex items-center gap-3">
                            <Monitor size={20} />
                            <span>Prevent Minimize (OBS)</span>
                        </div>
                        <div className={`w-2 h-2 rounded-full ${preventMinimizeForObs ? 'bg-sky-400' : 'bg-gray-600'}`} />
                    </button>

                    {needsRestart && (
                        <div className="rounded-lg border border-gray-700 bg-gray-900/50 px-3 py-2 text-[11px] text-gray-400">
                            <div>Restart required to apply render mode.</div>
                            {canRelaunch && (
                                <button
                                    onClick={handleRestart}
                                    className="mt-2 w-full rounded-lg border border-emerald-500/40 bg-emerald-600/20 px-2 py-1 text-emerald-200 hover:bg-emerald-600/30"
                                >
                                    Restart Now
                                </button>
                            )}
                        </div>
                    )}
                </div>

                {/* Section: Face Controls */}
                <div className="space-y-3">
                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Face Features</div>

                    <button
                        onClick={() => setEnableFaceSwap(!enableFaceSwap)}
                        className={`w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all border ${enableFaceSwap
                            ? 'bg-blue-600/20 border-blue-500/50 text-blue-200'
                            : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-750'
                            }`}
                    >
                        <div className="flex items-center gap-3">
                            <User size={20} />
                            <span>2D Mask</span>
                        </div>
                        <div className={`w-2 h-2 rounded-full ${enableFaceSwap ? 'bg-blue-400' : 'bg-gray-600'}`} />
                    </button>

                    <label className="flex items-center gap-3 px-4 py-3 bg-gray-800 text-gray-300 rounded-xl hover:bg-gray-750 cursor-pointer transition-colors border border-gray-700">
                        <Settings size={20} />
                        <span className="flex-1">Upload Mask</span>
                        <input type="file" accept="image/*" className="hidden" onChange={handleFaceUpload} />
                    </label>
                </div>

                {/* Section: 3D Avatar */}
                <div className="space-y-3">
                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">3D Avatar</div>

                    <button
                        onClick={() => setEnable3DAvatar(!enable3DAvatar)}
                        className={`w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all border ${enable3DAvatar
                            ? 'bg-orange-600/20 border-orange-500/50 text-orange-200'
                            : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-750'
                            }`}
                    >
                        <div className="flex items-center gap-3">
                            <Box size={20} />
                            <span>3D Raccoon</span>
                        </div>
                        <div className={`w-2 h-2 rounded-full ${enable3DAvatar ? 'bg-orange-400' : 'bg-gray-600'}`} />
                    </button>

                    <div className="space-y-2 text-xs text-gray-400">
                        <div className="flex items-center justify-between">
                            <span>Head Scale</span>
                            <span className="text-gray-500">{headScale.toFixed(2)}</span>
                        </div>
                        <input
                            type="range"
                            min="0.8"
                            max="1.6"
                            step="0.01"
                            value={headScale}
                            onChange={(e) => setHeadScale(Number(e.target.value))}
                            className="w-full accent-orange-400"
                        />
                    </div>

                    <div className="space-y-2 text-xs text-gray-400">
                        <div className="flex items-center justify-between">
                            <span>Render Quality</span>
                            <span className="text-gray-500">{renderQuality.toFixed(2)}x</span>
                        </div>
                        <input
                            type="range"
                            min="0.8"
                            max="1.5"
                            step="0.05"
                            value={renderQuality}
                            onChange={(e) => setRenderQuality(Number(e.target.value))}
                            className="w-full accent-orange-400"
                        />
                    </div>
                </div>

                {/* Section: Background */}
                <div className="space-y-3">
                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Background</div>

                    <button
                        onClick={() => setEnableBackgroundReplace(!enableBackgroundReplace)}
                        className={`w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all border ${enableBackgroundReplace
                            ? 'bg-purple-600/20 border-purple-500/50 text-purple-200'
                            : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-750'
                            }`}
                    >
                        <div className="flex items-center gap-3">
                            <ImageIcon size={20} />
                            <span>Replace BG</span>
                        </div>
                        <div className={`w-2 h-2 rounded-full ${enableBackgroundReplace ? 'bg-purple-400' : 'bg-gray-600'}`} />
                    </button>

                    <label className="flex items-center gap-3 px-4 py-3 bg-gray-800 text-gray-300 rounded-xl hover:bg-gray-750 cursor-pointer transition-colors border border-gray-700">
                        <Settings size={20} />
                        <span className="flex-1">Upload BG</span>
                        <input type="file" accept="image/*" className="hidden" onChange={handleBgUpload} />
                    </label>

                    <button
                        onClick={handleClearBg}
                        disabled={!backgroundImage}
                        className={`w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all border ${backgroundImage
                            ? 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-750'
                            : 'bg-gray-900 border-gray-800 text-gray-600 cursor-not-allowed'
                            }`}
                    >
                        <span>Clear BG</span>
                        <div className="w-2 h-2 rounded-full bg-gray-600" />
                    </button>
                </div>

                {/* Section: Output */}
                <div className="pt-4 mt-auto border-t border-gray-800">
                    <button
                        onClick={() => setCleanMode(true)}
                        className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-green-600/20 text-green-400 rounded-xl border border-green-500/30 hover:bg-green-600/30 transition-colors"
                    >
                        <ExternalLink size={18} />
                        <span>Clean Output Mode</span>
                    </button>
                    <p className="text-[10px] text-gray-500 text-center mt-2">
                        Left preview is clean. Use OBS to capture the specific window region if needed.
                    </p>
                </div>
                </div>
            )}
        </div>
    );
}
