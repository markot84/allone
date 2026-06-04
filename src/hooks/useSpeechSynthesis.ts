import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const MAX_AUTO_READ_CHARS = 1400;

function getSpeechSynthesis(): SpeechSynthesis | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
  return window.speechSynthesis;
}

function isGreekVoice(voice: SpeechSynthesisVoice): boolean {
  const haystack = `${voice.lang} ${voice.name}`.toLowerCase();
  return haystack.includes('el') || haystack.includes('greek') || haystack.includes('ελλην');
}

function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  return (
    voices.find((voice) => voice.lang.toLowerCase() === 'el-gr') ??
    voices.find((voice) => voice.lang.toLowerCase().startsWith('el')) ??
    voices.find(isGreekVoice) ??
    voices.find((voice) => voice.default) ??
    voices[0] ??
    null
  );
}

export function cleanTextForSpeech(text: string, maxChars = MAX_AUTO_READ_CHARS): string {
  const cleaned = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\*\*|__|\*/g, '')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/\n{2,}/g, '. ')
    .replace(/\s+/g, ' ')
    .trim();

  if (cleaned.length <= maxChars) return cleaned;

  const slice = cleaned.slice(0, maxChars);
  const lastSentence = Math.max(slice.lastIndexOf('.'), slice.lastIndexOf(';'), slice.lastIndexOf('!'), slice.lastIndexOf('?'));
  return `${slice.slice(0, lastSentence > 400 ? lastSentence + 1 : maxChars).trim()} Θα σταματήσω εδώ για να μη γίνει πολύ μεγάλο.`;
}

export function useSpeechSynthesis() {
  const synthRef = useRef<SpeechSynthesis | null>(null);
  const [supported] = useState(() => getSpeechSynthesis() !== null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    const synth = getSpeechSynthesis();
    synthRef.current = synth;
    if (!synth) return;

    const loadVoices = () => {
      setVoices(synth.getVoices());
    };

    loadVoices();
    synth.addEventListener?.('voiceschanged', loadVoices);
    return () => {
      synth.removeEventListener?.('voiceschanged', loadVoices);
    };
  }, []);

  const selectedVoice = useMemo(() => pickVoice(voices), [voices]);

  const stop = useCallback(() => {
    const synth = synthRef.current;
    if (!synth) return;
    synth.cancel();
    setSpeaking(false);
  }, []);

  const speak = useCallback(
    (text: string, opts?: { full?: boolean }) => {
      const synth = synthRef.current;
      if (!synth) return false;
      const spokenText = cleanTextForSpeech(text, opts?.full ? 4000 : MAX_AUTO_READ_CHARS);
      if (!spokenText) return false;

      synth.cancel();
      if (synth.paused) synth.resume();
      const utterance = new SpeechSynthesisUtterance(spokenText);
      utterance.lang = selectedVoice?.lang || 'el-GR';
      if (selectedVoice) utterance.voice = selectedVoice;
      utterance.rate = 0.96;
      utterance.pitch = 1;
      utterance.onstart = () => setSpeaking(true);
      utterance.onend = () => setSpeaking(false);
      utterance.onerror = () => setSpeaking(false);
      synth.speak(utterance);
      window.setTimeout(() => {
        if (synth.paused) synth.resume();
      }, 250);
      return true;
    },
    [selectedVoice]
  );

  useEffect(() => stop, [stop]);

  return {
    supported,
    speaking,
    voices,
    selectedVoice,
    speak,
    stop,
  };
}
