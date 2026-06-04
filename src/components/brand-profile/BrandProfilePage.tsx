import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, CardHeader, PageHeader, Spinner, useToast } from '../common';
import { Palette, Plus, Save, Trash2, UserRound } from 'lucide-react';
import { useBrand } from '../../hooks/useBrand';
import {
  BRAND_ARCHETYPES,
  createEmptyIcp,
  normalizeBrandProfile,
  saveBrandProfile,
} from '../../services/brandProfile';
import type { BrandArchetype, BrandICP, BrandIcpPriceSensitivity, BrandProfile } from '../../types';

const PRICE_LABEL: Record<BrandIcpPriceSensitivity, string> = {
  low: 'Χαμηλή',
  medium: 'Μέτρια',
  high: 'Υψηλή',
};

function TextareaField({
  label,
  value,
  onChange,
  placeholder,
  rows = 3,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[#6B7280]">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        placeholder={placeholder}
        className="w-full resize-none rounded-xl border border-[#E5E7EB] bg-white px-3 py-2 text-sm text-[var(--nts-charcoal)] outline-none transition-colors focus:border-[var(--nts-accent)]"
      />
    </label>
  );
}

function IcpEditor({
  icp,
  onChange,
  onRemove,
}: {
  icp: BrandICP;
  onChange: (patch: Partial<BrandICP>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-xl border border-[#E5E7EB] bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <UserRound size={16} className="text-[var(--nts-accent)]" />
          <input
            value={icp.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="π.χ. Elite Tennis Competitor"
            className="min-w-0 flex-1 rounded-lg border border-[#E5E7EB] px-3 py-1.5 text-sm font-semibold outline-none focus:border-[var(--nts-accent)]"
          />
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="rounded-lg p-2 text-red-500 transition-colors hover:bg-red-50"
          aria-label="Διαγραφή ICP"
        >
          <Trash2 size={16} />
        </button>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <TextareaField
          label="Περιγραφή"
          value={icp.description}
          onChange={(value) => onChange({ description: value })}
          placeholder="Ποιος είναι, επίπεδο ωριμότητας, τι αγοράζει, τι τον κινητοποιεί."
        />
        <TextareaField
          label="Ανάγκες"
          value={icp.needs}
          onChange={(value) => onChange({ needs: value })}
          placeholder="Τι προσπαθεί να πετύχει, ποια jobs-to-be-done έχει."
        />
        <TextareaField
          label="Αντιρρήσεις"
          value={icp.objections}
          onChange={(value) => onChange({ objections: value })}
          placeholder="Τι τον κρατά πίσω: τιμή, εμπιστοσύνη, διαθεσιμότητα, expertise."
        />
        <TextareaField
          label="Μηνύματα που ανταποκρίνεται"
          value={icp.preferredMessages}
          onChange={(value) => onChange({ preferredMessages: value })}
          placeholder="Ποια angles/claims τον πείθουν."
        />
      </div>
      <div className="mt-3">
        <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Price sensitivity</span>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(PRICE_LABEL) as BrandIcpPriceSensitivity[]).map((level) => (
            <button
              key={level}
              type="button"
              onClick={() => onChange({ priceSensitivity: level })}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                icp.priceSensitivity === level
                  ? 'border-[var(--nts-accent)] bg-[var(--nts-accent)]/10 text-[var(--nts-accent)]'
                  : 'border-[#E5E7EB] text-[#4A4A4A] hover:border-[var(--nts-accent)]'
              }`}
            >
              {PRICE_LABEL[level]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function BrandProfilePage() {
  const { currentBrand, refreshBrands } = useBrand();
  const toast = useToast();
  const [profile, setProfile] = useState<BrandProfile>(() => normalizeBrandProfile(currentBrand?.brandProfile));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setProfile(normalizeBrandProfile(currentBrand?.brandProfile));
  }, [currentBrand?.id, currentBrand?.brandProfile]);

  const selectedArchetype = useMemo(
    () => BRAND_ARCHETYPES.find((a) => a.id === profile.archetype),
    [profile.archetype]
  );

  const updateIcp = (id: string, patch: Partial<BrandICP>) => {
    setProfile((prev) => ({
      ...prev,
      icps: prev.icps.map((icp) => (icp.id === id ? { ...icp, ...patch } : icp)),
    }));
  };

  const save = async () => {
    if (!currentBrand?.id || saving) return;
    setSaving(true);
    try {
      await saveBrandProfile(currentBrand.id, profile);
      await refreshBrands();
      toast.success('Το Brand Profile αποθηκεύτηκε.');
    } catch (err) {
      console.error('[BrandProfile] save:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={<h2 className="text-xl font-bold text-[#1A1A1A] sm:text-2xl">Brand Profile</h2>}
        description={
          <p className="text-sm text-[#4A4A4A]">
            Ταυτότητα, archetype, tone of voice και ICPs που καθοδηγούν Mark, Marketing Plan και μελλοντικά διαφημιστικά μηνύματα.
          </p>
        }
        actions={
          <Button icon={saving ? <Spinner size="sm" /> : <Save size={16} />} onClick={save} disabled={!currentBrand?.id || saving}>
            {saving ? 'Αποθήκευση…' : 'Αποθήκευση'}
          </Button>
        }
      />

      <Card padding="lg">
        <CardHeader title="Προφίλ brand" icon={<Palette size={18} className="text-[var(--nts-accent)]" />} />
        <div className="mt-4">
          <TextareaField
            label="Brand profile"
            value={profile.description}
            onChange={(description) => setProfile((prev) => ({ ...prev, description }))}
            rows={5}
            placeholder="Περιέγραψε positioning, ιστορία, υπόσχεση αξίας, προϊόντα/υπηρεσίες, διαφοροποίηση και τι δεν είναι το brand."
          />
        </div>
      </Card>

      <Card padding="lg">
        <CardHeader title="Brand archetype & tone of voice" />
        <div className="mt-4 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Archetype</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {BRAND_ARCHETYPES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() =>
                    setProfile((prev) => ({
                      ...prev,
                      archetype: item.id as BrandArchetype,
                      toneOfVoice: prev.toneOfVoice || item.toneHint,
                    }))
                  }
                  className={`rounded-xl border p-3 text-left transition-colors ${
                    profile.archetype === item.id
                      ? 'border-[var(--nts-accent)] bg-[var(--nts-accent)]/10'
                      : 'border-[#E5E7EB] bg-white hover:border-[var(--nts-accent)]/60'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-[#1A1A1A]">{item.label}</span>
                    {profile.archetype === item.id && <Badge variant="orange">active</Badge>}
                  </div>
                  <p className="mt-1 text-xs text-[#6B7280]">{item.description}</p>
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-3">
            {selectedArchetype && (
              <div className="rounded-xl border border-[var(--nts-accent)]/20 bg-[var(--nts-accent)]/5 p-3">
                <p className="text-xs font-semibold uppercase text-[var(--nts-accent)]">Tone starter</p>
                <p className="mt-1 text-sm text-[#4A4A4A]">{selectedArchetype.toneHint}</p>
              </div>
            )}
            <TextareaField
              label="Tone of voice"
              value={profile.toneOfVoice}
              onChange={(toneOfVoice) => setProfile((prev) => ({ ...prev, toneOfVoice }))}
              rows={8}
              placeholder="Π.χ. authoritative, premium, expert, concise. Να αποφεύγει φθηνή εκπτωτική γλώσσα και υπερβολικό hype."
            />
          </div>
        </div>
      </Card>

      <Card padding="lg">
        <div className="flex items-center justify-between gap-3">
          <CardHeader title="Ideal Customer Profiles" subtitle="Τα ICPs βοηθούν το AI να γράφει πιο στοχευμένα μηνύματα." />
          <Button
            variant="secondary"
            size="sm"
            icon={<Plus size={14} />}
            onClick={() => setProfile((prev) => ({ ...prev, icps: [...prev.icps, createEmptyIcp()] }))}
          >
            Προσθήκη ICP
          </Button>
        </div>
        <div className="mt-4 space-y-3">
          {profile.icps.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[#E5E7EB] bg-[#FAFAFA] p-4 text-sm text-[#6B7280]">
              Πρόσθεσε 1-3 βασικά ICPs για καλύτερη στόχευση σε Mark και Marketing Plan.
            </div>
          ) : (
            profile.icps.map((icp) => (
              <IcpEditor
                key={icp.id}
                icp={icp}
                onChange={(patch) => updateIcp(icp.id, patch)}
                onRemove={() => setProfile((prev) => ({ ...prev, icps: prev.icps.filter((row) => row.id !== icp.id) }))}
              />
            ))
          )}
        </div>
      </Card>
    </div>
  );
}

export default BrandProfilePage;
