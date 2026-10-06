"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { PRIORITY } from "./request-queue";
import { isDecodableUrl, loadSlice } from "./slice-source";
import { hasSlice, peekSlice, putSlice, DecodedImage } from "./slice-cache";

export type PlaybackState =
  | "INITIALIZING"
  | "LOADING"
  | "DECODING"
  | "READY"
  | "PLAYING"
  | "PAUSED"
  | "ERROR";

export interface PlaybackBufferStatus {
  playbackState: PlaybackState;
  bufferedCount: number;
  totalTarget: number;
  progressPercent: number;
  isReady: boolean;
  failedFrames: number[];
  errorMessage?: string;
  retry: () => void;
  isSliceDecoded: (index: number) => boolean;
}

export interface UsePlaybackBufferOptions {
  seriesId: string;
  total: number;
  currentSlice: number;
  urlAt: (index: number) => string | undefined;
  playing: boolean;
  onAutoPause?: () => void;
}

/** Max consecutive retries per failed frame */
const MAX_FRAME_RETRIES = 2;

/**
 * Intelligent Image & Slice Buffering Hook
 *
 * Implements the full clinical playback pipeline:
 * LOAD -> VALIDATE -> DECODE -> CACHE -> READY -> PLAY
 *
 * - When a series is opened, determines target frames:
 *   - For sequences <= 128 slices: buffers all slices so playback never stalls.
 *   - For large MPR stacks (> 128 slices): sliding-window buffer (min 48 slices)
 *     prioritized forward in playback order.
 * - Enforces explicit states:
 *   INITIALIZING -> LOADING -> DECODING -> READY -> PLAYING / PAUSED / ERROR
 * - Pre-decodes image bitmaps using `img.decode()` to eliminate UI rasterization stutter.
 * - Retries failed frames intelligently up to 2 times.
 * - Disables play until the minimum required frames are ready.
 */
export function usePlaybackBuffer({
  seriesId,
  total,
  currentSlice,
  urlAt,
  playing,
  onAutoPause,
}: UsePlaybackBufferOptions): PlaybackBufferStatus {
  const [playbackState, setPlaybackState] = useState<PlaybackState>("INITIALIZING");
  const [bufferedCount, setBufferedCount] = useState<number>(0);
  const [failedFrames, setFailedFrames] = useState<number[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
  const [retryTrigger, setRetryTrigger] = useState(0);

  const retryCounts = useRef<Map<number, number>>(new Map());
  const abortControllerRef = useRef<AbortController | null>(null);

  // Target slices to buffer based on total count
  const targetIndices = useMemo(() => {
    if (total <= 1) return [0];
    if (total <= 128) {
      // Buffer full sequence
      const list: number[] = [];
      for (let i = 0; i < total; i++) list.push(i);
      return list;
    }
    // Large volume: sliding window of 48 slices centered/ahead of current
    const windowSize = Math.min(total, 48);
    const list: number[] = [];
    const forwardReach = Math.floor(windowSize * 0.75); // 36 ahead
    const backwardReach = windowSize - forwardReach; // 12 behind
    for (let offset = -backwardReach; offset < forwardReach; offset++) {
      const idx = (currentSlice + offset + total) % total;
      if (!list.includes(idx)) list.push(idx);
    }
    return list;
  }, [total, currentSlice]);

  const totalTarget = targetIndices.length;

  const retry = useCallback(() => {
    retryCounts.current.clear();
    setFailedFrames([]);
    setErrorMessage(undefined);
    setRetryTrigger((n) => n + 1);
  }, []);

  const isSliceDecoded = useCallback(
    (index: number): boolean => {
      if (index < 0 || index >= total) return false;
      const url = urlAt(index);
      if (!url) return false;
      return hasSlice(url) || peekSlice(url) !== undefined;
    },
    [total, urlAt]
  );

  useEffect(() => {
    if (total <= 1) {
      setPlaybackState("READY");
      setBufferedCount(1);
      setFailedFrames([]);
      setErrorMessage(undefined);
      return;
    }

    // Cancel any active buffer session on series/retry change
    abortControllerRef.current?.abort();
    const ac = new AbortController();
    abortControllerRef.current = ac;

    setPlaybackState("LOADING");
    setErrorMessage(undefined);

    let isCancelled = false;
    let localBuffered = 0;
    const localFailed: number[] = [];

    // Order target slices prioritized from current slice forward
    const prioritized = [...targetIndices].sort((a, b) => {
      const distA = (a - currentSlice + total) % total;
      const distB = (b - currentSlice + total) % total;
      return distA - distB;
    });

    async function bufferQueue() {
      // Initial count of already cached frames
      for (const idx of prioritized) {
        if (isCancelled || ac.signal.aborted) return;
        const url = urlAt(idx);
        if (url && (hasSlice(url) || peekSlice(url))) {
          localBuffered++;
        }
      }
      setBufferedCount(localBuffered);

      // If already all buffered
      if (localBuffered >= totalTarget) {
        setPlaybackState((curr) => (curr === "PLAYING" ? "PLAYING" : "READY"));
        return;
      }

      // Process unbuffered frames
      for (const idx of prioritized) {
        if (isCancelled || ac.signal.aborted) return;

        const url = urlAt(idx);
        if (!url || !isDecodableUrl(url)) {
          continue;
        }

        // Already cached?
        if (hasSlice(url) || peekSlice(url)) {
          continue;
        }

        // PIPELINE: LOAD -> VALIDATE -> DECODE -> CACHE
        let success = false;
        let attempt = retryCounts.current.get(idx) || 0;

        while (attempt <= MAX_FRAME_RETRIES && !success && !isCancelled && !ac.signal.aborted) {
          try {
            setPlaybackState("LOADING");

            // 1. LOAD
            const priority = idx === currentSlice ? PRIORITY.current : PRIORITY.preload;
            const decoded: DecodedImage = await loadSlice(url, priority);

            if (isCancelled || ac.signal.aborted) return;

            // 2. VALIDATE
            if (!decoded || !decoded.objectUrl) {
              throw new Error(`Invalid slice payload at index ${idx}`);
            }

            // 3. DECODE (Force browser rasterization/GPU upload via Image.decode())
            setPlaybackState("DECODING");
            if (typeof Image !== "undefined" && decoded.objectUrl.startsWith("blob:")) {
              await new Promise<void>((resolve, reject) => {
                const img = new Image();
                img.onload = () => {
                  if ("decode" in img && typeof img.decode === "function") {
                    img.decode().then(resolve).catch(resolve);
                  } else {
                    resolve();
                  }
                };
                img.onerror = () => reject(new Error(`Failed to decode raster for slice ${idx}`));
                img.src = decoded.objectUrl;
              });
            }

            // 4. CACHE
            putSlice(url, decoded);

            localBuffered++;
            setBufferedCount(localBuffered);
            success = true;
          } catch (err) {
            attempt++;
            retryCounts.current.set(idx, attempt);
            if (attempt > MAX_FRAME_RETRIES) {
              localFailed.push(idx);
              setFailedFrames([...localFailed]);
            } else {
              // Exponential backoff before retry
              await new Promise((r) => setTimeout(r, 150 * attempt));
            }
          }
        }
      }

      if (isCancelled || ac.signal.aborted) return;

      // Check results
      if (localFailed.length > 0 && localFailed.length > totalTarget * 0.5) {
        setPlaybackState("ERROR");
        setErrorMessage(`Failed to buffer ${localFailed.length} slices. Please retry.`);
        onAutoPause?.();
      } else {
        // Minimum buffer threshold reached
        setPlaybackState((curr) => (curr === "PLAYING" ? "PLAYING" : "READY"));
        if (localFailed.length > 0) {
          setErrorMessage(`Warning: Slice(s) ${localFailed.slice(0, 3).join(", ")} failed to preload.`);
        }
      }
    }

    void bufferQueue();

    return () => {
      isCancelled = true;
      ac.abort();
    };
  }, [seriesId, total, totalTarget, targetIndices, urlAt, currentSlice, retryTrigger, onAutoPause]);

  // Sync playing state with playback state
  useEffect(() => {
    if (playing) {
      if (playbackState === "READY" || playbackState === "PAUSED") {
        setPlaybackState("PLAYING");
      } else if (playbackState !== "PLAYING") {
        // Not ready yet, auto pause to prevent choppy playback
        onAutoPause?.();
      }
    } else {
      if (playbackState === "PLAYING") {
        setPlaybackState("PAUSED");
      }
    }
  }, [playing, playbackState, onAutoPause]);

  const progressPercent = totalTarget > 0 ? Math.min(100, Math.round((bufferedCount / totalTarget) * 100)) : 100;
  const isReady = playbackState === "READY" || playbackState === "PLAYING" || playbackState === "PAUSED";

  return {
    playbackState,
    bufferedCount,
    totalTarget,
    progressPercent,
    isReady,
    failedFrames,
    errorMessage,
    retry,
    isSliceDecoded,
  };
}
