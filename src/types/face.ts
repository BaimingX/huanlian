export type FaceBox = {
    x: number;
    y: number;
    width: number;
    height: number;
};

export type FrameSize = {
    width: number;
    height: number;
};

export type FaceSnapshot = {
    landmarks: Array<{ x: number; y: number; z?: number }>;
    matrix?: number[];
    blendshapes?: Array<{ name: string; score: number }>;
    timestamp: number;
};
