import { useEffect, useState } from 'react';
import { Save, FolderOpen } from 'lucide-react';
import { Button } from '../common';
import {
  getPresets,
  savePreset,
  loadPreset,
  deletePreset,
} from '../../data/weightPresets';

interface CustomToolsCardProps {
  weights: Record<string, number>;
  onWeightsChange: (w: Record<string, number>) => void;
  canSavePreset: boolean;
  onPresetSaved: () => void;
}

export function CustomToolsCard({
  weights,
  onWeightsChange,
  canSavePreset,
  onPresetSaved,
}: CustomToolsCardProps) {
  const [saveName, setSaveName] = useState('');
  const [showSaveInline, setShowSaveInline] = useState(false);
  const [loadPresetId, setLoadPresetId] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [presets, setPresets] = useState(getPresets());

  const refreshPresets = () => setPresets(getPresets());

  useEffect(() => {
    if (!canSavePreset) setShowSaveInline(false);
  }, [canSavePreset]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const handleSave = () => {
    if (!canSavePreset) return;
    const name = saveName.trim() || `Custom ${new Date().toLocaleDateString('el-GR')}`;
    savePreset({ name, weights, clonedFrom: undefined });
    setSaveName('');
    setShowSaveInline(false);
    refreshPresets();
    onPresetSaved();
    showToast(`Saved: ${name}`);
  };

  const handleLoad = () => {
    if (!loadPresetId) return;
    const preset = loadPreset(loadPresetId);
    if (preset) {
      onWeightsChange(preset.weights);
      showToast(`Φορτώθηκε: ${preset.name}`);
      setLoadPresetId('');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
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
            <Button
              variant="primary"
              size="sm"
              icon={<Save size={14} />}
              onClick={handleSave}
              disabled={!canSavePreset}
            >
              Αποθήκευση
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setShowSaveInline(false)}>
              Ακύρωση
            </Button>
          </div>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            icon={<Save size={14} />}
            onClick={() => setShowSaveInline(true)}
            disabled={!canSavePreset}
          >
            Αποθήκευση preset
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
              <option value="">— Φόρτωση preset —</option>
              {presets.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <Button variant="secondary" size="sm" icon={<FolderOpen size={14} />} onClick={handleLoad} disabled={!loadPresetId}>
              Φόρτωση
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (loadPresetId) {
                  deletePreset(loadPresetId);
                  setLoadPresetId('');
                  refreshPresets();
                  showToast('Διαγράφηκε');
                }
              }}
              disabled={!loadPresetId}
              className="text-[#EF4444] hover:text-[#DC2626]"
            >
              Διαγραφή
            </Button>
          </div>
        )}

      </div>

      {toast && (
        <div className="text-sm text-[#22C55E] font-medium animate-pulse">
          {toast}
        </div>
      )}
    </div>
  );
}
