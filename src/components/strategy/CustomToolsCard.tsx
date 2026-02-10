import { useState, useRef } from 'react';
import { Save, FolderOpen, GitCompare, Download, Upload } from 'lucide-react';
import { Button } from '../common';
import { scenarios } from '../../data';
import {
  getPresets,
  savePreset,
  loadPreset,
  deletePreset,
  exportWeightsToJson,
  importWeightsFromJson,
} from '../../data/weightPresets';

interface CustomToolsCardProps {
  weights: Record<string, number>;
  onWeightsChange: (w: Record<string, number>) => void;
  onCompareClick: () => void;
}

export function CustomToolsCard({ weights, onWeightsChange, onCompareClick }: CustomToolsCardProps) {
  const [saveName, setSaveName] = useState('');
  const [showSaveInline, setShowSaveInline] = useState(false);
  const [loadPresetId, setLoadPresetId] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [presets, setPresets] = useState(getPresets());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refreshPresets = () => setPresets(getPresets());

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const handleCloneFrom = (scenarioId: string) => {
    const scenario = scenarios.find((s) => s.id === scenarioId);
    if (scenario?.weights) {
      onWeightsChange({ ...scenario.weights });
      showToast(`Cloned from ${scenario.name}`);
    }
  };

  const handleSave = () => {
    const name = saveName.trim() || `Custom ${new Date().toLocaleDateString('el-GR')}`;
    savePreset({ name, weights, clonedFrom: undefined });
    setSaveName('');
    setShowSaveInline(false);
    refreshPresets();
    showToast(`Saved: ${name}`);
  };

  const handleLoad = () => {
    if (!loadPresetId) return;
    const preset = loadPreset(loadPresetId);
    if (preset) {
      onWeightsChange(preset.weights);
      showToast(`Loaded: ${preset.name}`);
      setLoadPresetId('');
    }
  };

  const handleExport = () => {
    const blob = new Blob([exportWeightsToJson(weights)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `weights-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Exported');
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = importWeightsFromJson(reader.result as string);
      if (result) {
        onWeightsChange(result.weights);
        showToast(result.name ? `Imported: ${result.name}` : 'Imported');
      } else {
        showToast('Invalid file');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        {/* Clone from */}
        <div>
          <label className="text-xs text-[#4A4A4A] block mb-1">Clone from</label>
          <select
            value=""
            onChange={(e) => {
              const v = e.target.value;
              if (v) handleCloneFrom(v);
              e.target.value = '';
            }}
            className="px-3 py-2 bg-[#F5F5F5] border border-transparent rounded-lg text-sm"
          >
            <option value="">— Επέλεξε —</option>
            {scenarios.filter((s) => s.weights).map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        {/* Save preset */}
        {showSaveInline ? (
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Όνομα preset"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
              className="px-3 py-2 w-40 bg-white border border-[#E5E5E5] rounded-lg text-sm"
              autoFocus
            />
            <Button variant="primary" size="sm" icon={<Save size={14} />} onClick={handleSave}>
              Αποθήκευση
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setShowSaveInline(false)}>
              Ακύρωση
            </Button>
          </div>
        ) : (
          <Button variant="secondary" size="sm" icon={<Save size={14} />} onClick={() => setShowSaveInline(true)}>
            Save preset
          </Button>
        )}

        {/* Load preset */}
        {presets.length > 0 && (
          <div className="flex items-center gap-2">
            <select
              value={loadPresetId}
              onChange={(e) => setLoadPresetId(e.target.value)}
              className="px-3 py-2 bg-[#F5F5F5] border border-transparent rounded-lg text-sm"
            >
              <option value="">— Load preset —</option>
              {presets.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <Button variant="secondary" size="sm" icon={<FolderOpen size={14} />} onClick={handleLoad} disabled={!loadPresetId}>
              Load
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (loadPresetId) {
                  deletePreset(loadPresetId);
                  setLoadPresetId('');
                  refreshPresets();
                  showToast('Deleted');
                }
              }}
              disabled={!loadPresetId}
              className="text-[#EF4444] hover:text-[#DC2626]"
            >
              Delete
            </Button>
          </div>
        )}

        {/* Compare */}
        <Button variant="secondary" size="sm" icon={<GitCompare size={14} />} onClick={onCompareClick}>
          Compare scenarios
        </Button>

        {/* Export */}
        <Button variant="ghost" size="sm" icon={<Download size={14} />} onClick={handleExport}>
          Export JSON
        </Button>

        {/* Import */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          className="hidden"
          onChange={handleImport}
        />
        <Button variant="ghost" size="sm" icon={<Upload size={14} />} onClick={() => fileInputRef.current?.click()}>
          Import JSON
        </Button>
      </div>

      {toast && (
        <div className="text-sm text-[#22C55E] font-medium animate-pulse">
          {toast}
        </div>
      )}
    </div>
  );
}
