"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface VoiceDictationButtonProps {
  onTranscript: (text: string) => void;
  className?: string;
  disabled?: boolean;
}

export function VoiceDictationButton({
  onTranscript,
  className,
  disabled = false,
}: VoiceDictationButtonProps) {
  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        setIsSupported(true);
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = "en-US";

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        recognition.onresult = (event: any) => {
          let currentTranscript = "";
          for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
              currentTranscript += event.results[i][0].transcript;
            }
          }
          if (currentTranscript.trim()) {
            onTranscript(currentTranscript.trim());
          }
        };

        recognition.onerror = () => {
          setIsListening(false);
        };

        recognition.onend = () => {
          setIsListening(false);
        };

        recognitionRef.current = recognition;
      }
    }
  }, [onTranscript]);

  const toggleListening = () => {
    if (!recognitionRef.current || disabled) return;

    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      try {
        recognitionRef.current.start();
        setIsListening(true);
      } catch {
        setIsListening(false);
      }
    }
  };

  if (!isSupported) {
    return (
      <button
        type="button"
        disabled
        title="Voice dictation not supported in this browser environment."
        className={cn(
          "inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium text-ink-muted opacity-40 cursor-not-allowed",
          className
        )}
      >
        <MicOff className="h-3 w-3" />
        <span>Dictate (N/A)</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggleListening}
      disabled={disabled}
      title={isListening ? "Stop voice dictation" : "Click to dictate clinical observations"}
      className={cn(
        "inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] font-medium transition-all",
        isListening
          ? "border-critical bg-critical-dim text-critical animate-pulse"
          : "border-border bg-panel-alt text-ink-secondary hover:border-clinical hover:text-clinical",
        disabled && "opacity-50 cursor-not-allowed",
        className
      )}
    >
      {isListening ? (
        <>
          <Loader2 className="h-3 w-3 animate-spin" />
          <span>Listening...</span>
        </>
      ) : (
        <>
          <Mic className="h-3 w-3" />
          <span>Dictate</span>
        </>
      )}
    </button>
  );
}
