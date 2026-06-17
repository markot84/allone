import { useCallback, useEffect, useRef, useState } from 'react';

/** Speech-to-text via the Web Speech API (browser-native, zero cost); alternative input for Mark,
 *  with graceful fallback when unsupported. */

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives?: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

function getRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Friendly error messages (instead of silent failure). */
function friendlyError(code?: string): string {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Δεν δόθηκε πρόσβαση στο μικρόφωνο. Επίτρεψέ το από τις ρυθμίσεις του browser και δοκίμασε ξανά.';
    case 'no-speech':
      return 'Δεν ακούστηκε ομιλία. Δοκίμασε ξανά.';
    case 'audio-capture':
      return 'Δεν βρέθηκε μικρόφωνο. Έλεγξε τη συσκευή σου.';
    case 'network':
      return 'Πρόβλημα δικτύου στη φωνητική αναγνώριση. Δοκίμασε ξανά.';
    case 'aborted':
      return '';
    default:
      return 'Η φωνητική είσοδος δεν λειτούργησε. Δοκίμασε ξανά.';
  }
}

export function useSpeechToText(opts?: { lang?: string; onResult?: (text: string) => void }) {
  const lang = opts?.lang ?? 'el-GR';
  const [supported] = useState<boolean>(() => getRecognitionCtor() !== null);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const onResultRef = useRef(opts?.onResult);
  useEffect(() => {
    onResultRef.current = opts?.onResult;
  }, [opts?.onResult]);

  const stop = useCallback(() => {
    try {
      recRef.current?.stop();
    } catch {
      /* ignore */
    }
    setListening(false);
  }, []);

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      setError('Ο browser δεν υποστηρίζει φωνητική είσοδο. Δοκίμασε Chrome/Edge.');
      return;
    }
    // If an active instance exists, abort it first (avoids InvalidStateError).
    try {
      recRef.current?.abort();
    } catch {
      /* ignore */
    }
    setError(null);
    try {
      const rec = new Ctor();
      rec.lang = lang;
      rec.interimResults = false;
      rec.continuous = false;
      rec.maxAlternatives = 1;
      rec.onresult = (event) => {
        let transcript = '';
        for (let i = 0; i < event.results.length; i++) {
          transcript += event.results[i][0]?.transcript ?? '';
        }
        const text = transcript.trim();
        if (text) {
          onResultRef.current?.(text);
          setListening(false);
          try {
            rec.stop();
          } catch {
            /* ignore */
          }
        }
      };
      rec.onerror = (event) => {
        const msg = friendlyError(event?.error);
        if (msg) setError(msg);
        setListening(false);
      };
      rec.onend = () => setListening(false);
      recRef.current = rec;
      rec.start();
      setListening(true);
    } catch {
      setError('Η εκκίνηση του μικροφώνου απέτυχε. Δοκίμασε ξανά.');
      setListening(false);
    }
  }, [lang]);

  const toggle = useCallback(() => {
    if (listening) stop();
    else start();
  }, [listening, start, stop]);

  useEffect(() => {
    return () => {
      try {
        recRef.current?.abort();
      } catch {
        /* ignore */
      }
    };
  }, []);

  return { supported, listening, error, clearError: () => setError(null), start, stop, toggle };
}
