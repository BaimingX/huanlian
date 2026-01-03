import type { FaceBox } from '../types/face';

export function computeFaceBox(
    landmarks: Array<{ x: number; y: number }>,
    frameWidth: number,
    frameHeight: number,
    padX: number,
    padY: number,
    yShift: number,
    mirrorX: boolean
): FaceBox {
    let minX = 1;
    let minY = 1;
    let maxX = 0;
    let maxY = 0;
    for (const pt of landmarks) {
        if (pt.x < minX) minX = pt.x;
        if (pt.y < minY) minY = pt.y;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.y > maxY) maxY = pt.y;
    }

    const boxMinX = mirrorX ? 1 - maxX : minX;
    const boxMaxX = mirrorX ? 1 - minX : maxX;
    const baseX = boxMinX * frameWidth;
    const baseY = minY * frameHeight;
    const width = (boxMaxX - boxMinX) * frameWidth;
    const height = (maxY - minY) * frameHeight;

    const padXSize = width * padX;
    const padYSize = height * padY;

    return {
        x: baseX - padXSize * 0.5,
        y: baseY - padYSize * yShift,
        width: width + padXSize,
        height: height + padYSize,
    };
}
