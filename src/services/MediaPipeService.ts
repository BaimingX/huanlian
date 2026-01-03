import {
    FaceLandmarker,
    FilesetResolver,
    ImageSegmenter,
    FaceLandmarkerResult,
    ImageSegmenterResult
} from "@mediapipe/tasks-vision";

export class MediaPipeService {
    private static instance: MediaPipeService;
    private faceLandmarker: FaceLandmarker | null = null;
    private imageSegmenter: ImageSegmenter | null = null;
    private isInitializing = false;
    private wasmBasePath = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/wasm";
    private faceModelPath = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
    private segmenterModelPath = "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite";

    private constructor() { }

    static getInstance(): MediaPipeService {
        if (!MediaPipeService.instance) {
            MediaPipeService.instance = new MediaPipeService();
        }
        return MediaPipeService.instance;
    }

    async initialize() {
        if (this.faceLandmarker && this.imageSegmenter) return;
        if (this.isInitializing) return;

        this.isInitializing = true;
        try {
            const vision = await FilesetResolver.forVisionTasks(this.wasmBasePath);
            const delegates = this.getDelegateOrder();

            // Initialize Face Landmarker with GPU fallback to CPU.
            this.faceLandmarker = await this.createWithDelegates(
                (delegate) => this.createFaceLandmarker(vision, delegate),
                delegates
            );

            // Initialize Image Segmenter (Selfie Segmenter) with GPU fallback.
            this.imageSegmenter = await this.createWithDelegates(
                (delegate) => this.createImageSegmenter(vision, delegate),
                delegates
            );

            console.log("MediaPipe initialized successfully");
        } catch (error) {
            console.error("Failed to initialize MediaPipe:", error);
            throw error;
        } finally {
            this.isInitializing = false;
        }
    }

    detectFace(video: HTMLVideoElement, startTimeMs: number): FaceLandmarkerResult | null {
        if (!this.faceLandmarker) return null;
        return this.faceLandmarker.detectForVideo(video, startTimeMs);
    }

    segmentImage(video: HTMLVideoElement, startTimeMs: number, callback: (result: ImageSegmenterResult) => void) {
        if (!this.imageSegmenter) return;
        this.imageSegmenter.segmentForVideo(video, startTimeMs, callback);
    }

    private createFaceLandmarker(vision: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>, delegate: "CPU" | "GPU") {
        return FaceLandmarker.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath: this.faceModelPath,
                delegate
            },
            outputFaceBlendshapes: true,
            outputFacialTransformationMatrixes: true,
            runningMode: "VIDEO",
            numFaces: 1
        });
    }

    private createImageSegmenter(vision: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>, delegate: "CPU" | "GPU") {
        return ImageSegmenter.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath: this.segmenterModelPath,
                delegate
            },
            runningMode: "VIDEO",
            outputCategoryMask: true,
            outputConfidenceMasks: true
        });
    }

    private getDelegateOrder(): Array<"CPU" | "GPU"> {
        const isElectron = typeof window !== "undefined"
            && typeof (window as { process?: { versions?: { electron?: string } } }).process !== "undefined"
            && Boolean((window as { process?: { versions?: { electron?: string } } }).process?.versions?.electron);
        let renderMode: "cpu" | "gpu" | null = null;
        if (typeof window !== "undefined") {
            try {
                const stored = window.localStorage.getItem("renderMode");
                if (stored === "cpu" || stored === "gpu") {
                    renderMode = stored;
                }
            } catch {
                renderMode = null;
            }
        }
        if (isElectron) {
            return renderMode === "gpu" ? ["GPU", "CPU"] : ["CPU"];
        }
        return ["GPU", "CPU"];
    }

    private async createWithDelegates<T>(
        createFn: (delegate: "CPU" | "GPU") => Promise<T>,
        delegates: Array<"CPU" | "GPU">
    ): Promise<T> {
        let lastError: unknown;
        for (const delegate of delegates) {
            try {
                return await createFn(delegate);
            } catch (error) {
                lastError = error;
                console.warn(`MediaPipe init failed with ${delegate}, retrying...`, error);
            }
        }
        throw lastError;
    }
}
