export interface MixConfigPreset {
  scenarioA: string;
  scenarioB: string;
  percentA: number;
  percentB: number;
}

export interface WeightPreset {
  id: string;
  name: string;
  weights: Record<string, number>;
  scenarioId?: string;
  mixConfig?: MixConfigPreset;
  duration?: number | 'ongoing';
  seasonId?: string;
  createdAt: string;
  clonedFrom?: string;
}

const STORAGE_KEY = 'performance-plus_weight_presets';

export function getPresets(): WeightPreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function savePreset(preset: Omit<WeightPreset, 'id' | 'createdAt'>): WeightPreset {
  const presets = getPresets();
  const newPreset: WeightPreset = {
    ...preset,
    id: `preset_${Date.now()}`,
    createdAt: new Date().toISOString(),
  };
  presets.unshift(newPreset);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  return newPreset;
}

export function deletePreset(id: string): void {
  const presets = getPresets().filter((p) => p.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
}

export function loadPreset(id: string): WeightPreset | undefined {
  return getPresets().find((p) => p.id === id);
}

export function exportWeightsToJson(weights: Record<string, number>, name?: string): string {
  return JSON.stringify(
    { name: name ?? 'Custom Weights', weights, exportedAt: new Date().toISOString() },
    null,
    2
  );
}

export function importWeightsFromJson(json: string): { name?: string; weights: Record<string, number> } | null {
  try {
    const data = JSON.parse(json);
    if (!data.weights || typeof data.weights !== 'object') return null;
    const weights = data.weights as Record<string, number>;
    const required = ['profit', 'stock', 'strategic', 'revenue', 'fit'];
    if (!required.every((k) => typeof weights[k] === 'number')) return null;
    return { name: data.name, weights };
  } catch {
    return null;
  }
}
