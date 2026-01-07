import { useCallback, useEffect, useRef, useState } from "react";

export function useCamera() {
    const videoRef = useRef<HTMLVideoElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const [error, setError] = useState<string | null>(null);
    const lastRestartAtRef = useRef(0);

    const stopStream = useCallback(() => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach((track) => track.stop());
            streamRef.current = null;
        }
    }, []);

    const startStream = useCallback(async () => {
        try {
            console.log("Requesting webcam access...");
            const ms = await navigator.mediaDevices.getUserMedia({
                video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
                audio: false,
            });

            console.log("Webcam access granted.");
            streamRef.current = ms;
            const v = videoRef.current;
            if (v) {
                v.srcObject = ms;
                v.muted = true;
                v.playsInline = true;
                try {
                    await v.play();
                    console.log("Video playing.");
                } catch (playErr) {
                    console.error("Error playing video:", playErr);
                }
            }
        } catch (err: any) {
            console.error("Error accessing webcam:", err);
            setError(`${err?.name || "Error"}: ${err?.message || String(err)}`);
        }
    }, []);

    const restartStream = useCallback(async (reason?: string) => {
        const now = Date.now();
        if (now - lastRestartAtRef.current < 1500) {
            return;
        }
        lastRestartAtRef.current = now;
        console.log("Restarting camera stream", reason ? `(${reason})` : "");
        stopStream();
        await startStream();
    }, [startStream, stopStream]);

    useEffect(() => {
        startStream().catch(() => {
            // Errors handled in startStream.
        });

        return () => {
            console.log("Cleaning up camera...");
            stopStream();
        };
    }, [startStream, stopStream]);

    useEffect(() => {
        const handleResume = () => {
            const video = videoRef.current;
            const trackEnded = streamRef.current?.getVideoTracks().some((track) => track.readyState === "ended") ?? false;
            if (trackEnded || !video || video.readyState < 2) {
                restartStream("resume");
                return;
            }
            if (video.paused) {
                video.play().catch(() => {
                    restartStream("resume-play-failed");
                });
            }
        };
        document.addEventListener("visibilitychange", handleResume);
        window.addEventListener("focus", handleResume);
        return () => {
            document.removeEventListener("visibilitychange", handleResume);
            window.removeEventListener("focus", handleResume);
        };
    }, [restartStream]);

    useEffect(() => {
        const ipc = window.ipcRenderer;
        if (!ipc?.on || !ipc?.off) {
            return;
        }
        const handler = () => {
            restartStream("ipc-resume");
        };
        ipc.on("app:renderer-resume", handler);
        return () => {
            ipc.off("app:renderer-resume", handler);
        };
    }, [restartStream]);

    return { videoRef, stream: streamRef.current, error, restartStream };
}
