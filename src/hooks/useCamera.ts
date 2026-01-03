import { useEffect, useRef, useState } from "react";

export function useCamera() {
    const videoRef = useRef<HTMLVideoElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let alive = true;

        (async () => {
            try {
                console.log("Requesting webcam access...");
                const ms = await navigator.mediaDevices.getUserMedia({
                    video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
                    audio: false,
                });

                if (!alive) {
                    console.log("Component unmounted, stopping stream immediately.");
                    ms.getTracks().forEach(t => t.stop());
                    return;
                }

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
        })();

        return () => {
            console.log("Cleaning up camera...");
            alive = false;
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(t => t.stop());
                streamRef.current = null;
            }
        };
    }, []);

    return { videoRef, stream: streamRef.current, error };
}
