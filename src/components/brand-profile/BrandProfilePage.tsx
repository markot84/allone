import { useEffect, useMemo, useState } from 'react';
import { Button, Card, CardHeader, PageHeader, Spinner, useToast } from '../common';
import { Palette, Plus, Save, Trash2, UserRound } from 'lucide-react';
import { useBrand } from '../../hooks/useBrand';
import {
  BRAND_ARCHETYPES,
  createEmptyIcp,
  normalizeBrandProfile,
  saveBrandProfile,
} from '../../services/brandProfile';
import type { BrandArchetype, BrandICP, BrandIcpPriceSensitivity, BrandProfile } from '../../types';
import { logger } from '../../utils/logger';
import { useFullBleedCanvas } from '../layout/AppChrome';
import { PageCanvas } from '../layout/ChromeControls';

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
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        placeholder={placeholder}
        className="w-full resize-none rounded-xl border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--nts-charcoal)] outline-none transition-colors focus:border-[var(--nts-accent)]"
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
    <div className="rounded-xl border border-[var(--border)] bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <UserRound size={16} className="text-[var(--nts-accent-text)]" />
          <input
            value={icp.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="π.χ. Elite Tennis Competitor"
            className="min-w-0 flex-1 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-semibold outline-none focus:border-[var(--nts-accent)]"
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
        <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Price sensitivity</span>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(PRICE_LABEL) as BrandIcpPriceSensitivity[]).map((level) => (
            <button
              key={level}
              type="button"
              onClick={() => onChange({ priceSensitivity: level })}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                icp.priceSensitivity === level
                  ? 'border-[var(--nts-accent)] bg-[var(--nts-accent)]/10 text-[var(--nts-accent-text)]'
                  : 'border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--nts-accent)]'
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
  // The page draws its own gutters, so the shell drops its padded wrapper.
  useFullBleedCanvas();

  const { currentBrand, setCurrentBrand, refreshBrands } = useBrand();
  const toast = useToast();
  const [profile, setProfile] = useState<BrandProfile>(() => normalizeBrandProfile(currentBrand?.brandProfile));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setProfile(normalizeBrandProfile(currentBrand?.brandProfile));
  }, [currentBrand?.id, currentBrand?.brandProfile]);

  const primaryArchetype = useMemo(
    () => BRAND_ARCHETYPES.find((a) => a.id === profile.archetype),
    [profile.archetype]
  );
  const secondaryArchetype = useMemo(
    () => BRAND_ARCHETYPES.find((a) => a.id === profile.secondaryArchetype),
    [profile.secondaryArchetype]
  );

  const setArchetypeRole = (id: BrandArchetype, role: 'primary' | 'secondary') => {
    setProfile((prev) => {
      if (role === 'primary') {
        const nextPrimary = prev.archetype === id ? '' : id;
        return {
          ...prev,
          archetype: nextPrimary,
          secondaryArchetype: prev.secondaryArchetype === nextPrimary ? '' : prev.secondaryArchetype,
          toneOfVoice: prev.toneOfVoice || BRAND_ARCHETYPES.find((a) => a.id === id)?.toneHint || '',
        };
      }
      const nextSecondary = prev.secondaryArchetype === id ? '' : id;
      return {
        ...prev,
        secondaryArchetype: nextSecondary === prev.archetype ? '' : nextSecondary,
      };
    });
  };

  const updateIcp = (id: string, patch: Partial<BrandICP>) => {
    setProfile((prev) => ({
      ...prev,
      icps: prev.icps.map((icp) => (icp.id === id ? { ...icp, ...patch } : icp)),
    }));
  };

  const save = async () => {
    if (!currentBrand?.id || saving) return;
    setSaving(true);
    setError(null);
    try {
      const savedProfile: BrandProfile = { ...profile, updatedAt: new Date().toISOString() };
      await saveBrandProfile(currentBrand.id, savedProfile);
      setProfile(savedProfile);
      setCurrentBrand({ ...currentBrand, brandProfile: savedProfile });
      void refreshBrands().catch((err) => logger.warn('[BrandProfile] background refresh:', { err }));
      toast.success('Το Brand Profile αποθηκεύτηκε.');
    } catch (err) {
      logger.error('[BrandProfile] save:', { err });
      setError('Δεν ολοκληρώθηκε η αποθήκευση. Δοκίμασε ξανά σε λίγο.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageCanvas>
      <PageHeader
        eyebrow="Marketing"
        title="Brand Profile"
        description="Ταυτότητα, archetype, tone of voice και ICPs που καθοδηγούν Mark, Marketing Plan και μελλοντικά διαφημιστικά μηνύματα."
        actions={
          <Button icon={saving ? <Spinner size="sm" /> : <Save size={16} />} onClick={save} disabled={!currentBrand?.id || saving}>
            {saving ? 'Αποθήκευση…' : 'Αποθήκευση'}
          </Button>
        }
      />

      <Card padding="lg">
        <CardHeader title="Προφίλ brand" icon={<Palette size={18} className="text-[var(--nts-accent-text)]" />} />
        {error && (
          <div className="mb-4 rounded-lg border border-[var(--danger-light)] bg-[var(--danger-light)] px-3 py-2 text-sm text-[var(--danger-600)]">
            {error}
          </div>
        )}
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
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Archetype έως 2 επιλογές</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {BRAND_ARCHETYPES.map((item) => (
                <div
                  key={item.id}
                  className={`rounded-xl border p-3 text-left transition-colors ${
                    profile.archetype === item.id || profile.secondaryArchetype === item.id
                      ? 'border-[var(--nts-accent)] bg-[var(--nts-accent)]/10'
                      : 'border-[var(--border)] bg-white hover:border-[var(--nts-accent)]/60'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-[var(--text-primary)]">{item.label}</span>
                  </div>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">{item.description}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setArchetypeRole(item.id, 'primary')}
                      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                        profile.archetype === item.id
                          ? 'border-[var(--nts-accent)] btn-gold text-white'
                          : 'border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--nts-accent)]'
                      }`}
                    >
                      Βασικό
                    </button>
                    <button
                      type="button"
                      onClick={() => setArchetypeRole(item.id, 'secondary')}
                      disabled={profile.archetype === item.id}
                      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                        profile.secondaryArchetype === item.id
                          ? 'border-[var(--nts-accent)] bg-[var(--nts-accent)]/10 text-[var(--nts-accent-text)]'
                          : 'border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--nts-accent)]'
                      }`}
                    >
                      Συμπληρωματικό
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="space-y-3">
            {(primaryArchetype || secondaryArchetype) && (
              <div className="rounded-xl border border-[var(--nts-accent)]/20 bg-[var(--nts-accent)]/5 p-3">
                <p className="text-xs font-semibold uppercase text-[var(--nts-accent-text)]">Tone starter</p>
                <p className="mt-1 text-sm text-[var(--text-secondary)]">
                  {[
                    primaryArchetype ? `Βασικό (${primaryArchetype.label}): ${primaryArchetype.toneHint}` : '',
                    secondaryArchetype ? `Συμπληρωματικό (${secondaryArchetype.label}): ${secondaryArchetype.toneHint}` : '',
                  ].filter(Boolean).join(' · ')}
                </p>
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
            <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface-2)] p-4 text-sm text-[var(--text-muted)]">
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
    </PageCanvas>
  );
}

export default BrandProfilePage;
