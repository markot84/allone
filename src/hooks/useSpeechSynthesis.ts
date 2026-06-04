import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const MAX_AUTO_READ_CHARS = 1400;

const MALE_VOICE_HINTS = [
  'male',
  'man',
  'masculine',
  'nikos',
  'stefanos',
  'stephanos',
  'andreas',
  'george',
  'γιωργ',
  'νικ',
  'ανδρ',
  'στεφαν',
];

function getSpeechSynthesis(): SpeechSynthesis | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
  return window.speechSynthesis;
}

function isGreekVoice(voice: SpeechSynthesisVoice): boolean {
  const haystack = `${voice.lang} ${voice.name}`.toLowerCase();
  return haystack.includes('el') || haystack.includes('greek') || haystack.includes('ελλην');
}

function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const greekVoices = voices.filter((voice) => voice.lang.toLowerCase() === 'el-gr' || voice.lang.toLowerCase().startsWith('el') || isGreekVoice(voice));
  const maleGreek = greekVoices.find((voice) => {
    const haystack = `${voice.name} ${voice.voiceURI}`.toLowerCase();
    return MALE_VOICE_HINTS.some((hint) => haystack.includes(hint));
  });
  return (
    maleGreek ??
    greekVoices.find((voice) => voice.lang.toLowerCase() === 'el-gr') ??
    greekVoices[0] ??
    voices.find((voice) => voice.default) ??
    voices[0] ??
    null
  );
}

function parseLocalizedNumber(raw: string): number | null {
  const compact = raw.replace(/\s/g, '');
  const lastComma = compact.lastIndexOf(',');
  const lastDot = compact.lastIndexOf('.');
  let normalized = compact;

  if (lastComma !== -1 && lastDot !== -1) {
    const decimalSep = lastComma > lastDot ? ',' : '.';
    const thousandSep = decimalSep === ',' ? '.' : ',';
    normalized = compact.replaceAll(thousandSep, '').replace(decimalSep, '.');
  } else if (lastComma !== -1) {
    const [, decimals = ''] = compact.split(',');
    normalized = decimals.length === 3 ? compact.replaceAll(',', '') : compact.replace(',', '.');
  } else if (lastDot !== -1) {
    const [, decimals = ''] = compact.split('.');
    normalized = decimals.length === 3 ? compact.replaceAll('.', '') : compact;
  }

  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

function integerToGreekWords(value: number): string {
  const n = Math.trunc(Math.abs(value));
  const units = ['', 'ένα', 'δύο', 'τρία', 'τέσσερα', 'πέντε', 'έξι', 'επτά', 'οκτώ', 'εννέα'];
  const teens = ['δέκα', 'έντεκα', 'δώδεκα', 'δεκατρία', 'δεκατέσσερα', 'δεκαπέντε', 'δεκαέξι', 'δεκαεπτά', 'δεκαοκτώ', 'δεκαεννέα'];
  const tens = ['', '', 'είκοσι', 'τριάντα', 'σαράντα', 'πενήντα', 'εξήντα', 'εβδομήντα', 'ογδόντα', 'ενενήντα'];
  const hundreds = ['', 'εκατό', 'διακόσια', 'τριακόσια', 'τετρακόσια', 'πεντακόσια', 'εξακόσια', 'επτακόσια', 'οκτακόσια', 'εννιακόσια'];

  const underThousand = (num: number) => {
    const parts: string[] = [];
    const h = Math.floor(num / 100);
    const rest = num % 100;
    if (h) parts.push(hundreds[h]);
    if (rest >= 10 && rest < 20) parts.push(teens[rest - 10]);
    else {
      const t = Math.floor(rest / 10);
      const u = rest % 10;
      if (t) parts.push(tens[t]);
      if (u) parts.push(units[u]);
    }
    return parts.join(' ');
  };

  if (n === 0) return 'μηδέν';
  if (n < 1000) return underThousand(n);
  if (n < 1_000_000) {
    const thousands = Math.floor(n / 1000);
    const rest = n % 1000;
    const thousandsText = thousands === 1 ? 'χίλια' : `${underThousand(thousands)} χιλιάδες`;
    return [thousandsText, rest ? underThousand(rest) : ''].filter(Boolean).join(' ');
  }
  const millions = Math.floor(n / 1_000_000);
  const rest = n % 1_000_000;
  const millionsText = millions === 1 ? 'ένα εκατομμύριο' : `${integerToGreekWords(millions)} εκατομμύρια`;
  return [millionsText, rest ? integerToGreekWords(rest) : ''].filter(Boolean).join(' ');
}

function amountToGreekWords(value: number): string {
  const euros = Math.trunc(Math.abs(value));
  const cents = Math.round((Math.abs(value) - euros) * 100);
  const sign = value < 0 ? 'μείον ' : '';
  const euroText = `${integerToGreekWords(euros)} ${euros === 1 ? 'ευρώ' : 'ευρώ'}`;
  const centText = cents > 0 ? ` και ${integerToGreekWords(cents)} λεπτά` : '';
  return `${sign}${euroText}${centText}`;
}

function formatNumbersForSpeech(text: string): string {
  const numberSource = String.raw`[+-]?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?|[+-]?\d+(?:[.,]\d+)?`;
  const trailingCurrencyPattern = new RegExp(String.raw`(${numberSource})\s*(?:€|eur(?:o)?\b|e(?:\s*euro)?\b|ευρώ\b|ευρω\b)`, 'gi');
  const leadingCurrencyPattern = new RegExp(String.raw`(?:€|eur(?:o)?\b|e\s*euro\b|ευρώ\b|ευρω\b)\s*(${numberSource})`, 'gi');
  const percentPattern = /([+-]?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?|[+-]?\d+(?:[.,]\d+)?)(?:\s*)%/g;
  const thousandsPattern = /\b\d{1,3}(?:[.,]\d{3})+\b/g;

  return text
    .replace(leadingCurrencyPattern, (_match, raw: string) => {
      const value = parseLocalizedNumber(raw);
      return value === null ? _match : amountToGreekWords(value);
    })
    .replace(trailingCurrencyPattern, (_match, raw: string) => {
      const value = parseLocalizedNumber(raw);
      return value === null ? _match : amountToGreekWords(value);
    })
    .replace(percentPattern, (_match, raw: string) => {
      const value = parseLocalizedNumber(raw);
      if (value === null) return _match;
      return `${integerToGreekWords(Math.round(value))} τοις εκατό`;
    })
    .replace(thousandsPattern, (raw) => {
      const value = parseLocalizedNumber(raw);
      return value === null ? raw : integerToGreekWords(value);
    });
}

export function cleanTextForSpeech(text: string, maxChars = MAX_AUTO_READ_CHARS): string {
  const cleaned = formatNumbersForSpeech(text)
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
  return slice.slice(0, lastSentence > 400 ? lastSentence + 1 : maxChars).trim();
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

  const prime = useCallback(() => {
    const synth = synthRef.current;
    if (!synth) return false;
    try {
      if (synth.paused) synth.resume();
      const utterance = new SpeechSynthesisUtterance('.');
      utterance.lang = selectedVoice?.lang || 'el-GR';
      utterance.volume = 0;
      if (selectedVoice) utterance.voice = selectedVoice;
      synth.speak(utterance);
      return true;
    } catch {
      return false;
    }
  }, [selectedVoice]);

  const speak = useCallback(
    (text: string, opts?: { full?: boolean; onStart?: () => void; onError?: () => void }) => {
      const synth = synthRef.current;
      if (!synth) return false;
      const spokenText = cleanTextForSpeech(text, opts?.full ? 4000 : MAX_AUTO_READ_CHARS);
      if (!spokenText) return false;

      synth.cancel();
      if (synth.paused) synth.resume();
      const utterance = new SpeechSynthesisUtterance(spokenText);
      utterance.lang = selectedVoice?.lang || 'el-GR';
      if (selectedVoice) utterance.voice = selectedVoice;
      utterance.rate = 0.94;
      utterance.pitch = 0.68;
      utterance.onstart = () => {
        opts?.onStart?.();
        setSpeaking(true);
      };
      utterance.onend = () => setSpeaking(false);
      utterance.onerror = () => {
        opts?.onError?.();
        setSpeaking(false);
      };
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
    prime,
    speak,
    stop,
  };
}
