import { useState, useEffect, useMemo } from 'react';
import { Card, Button, useToast, Tooltip } from '../common';
import { useBrand } from '../../hooks/useBrand';
import { FirestoreService } from '../../services/firestore';
import { useQueryClient } from '@tanstack/react-query';
import { logger } from '../../utils/logger';
import type { Brand } from '../../types';

/** Reusable per-brand source-role settings card: a radio list bound to one brands/{brandId} field.
 *  Shows an effective default until the brand chooses; writes the value, refreshes, invalidates deps. */
export interface SourceRoleOption {
  id: string;
  label: string;
  description: string;
  /** When true, the option is shown but not selectable (e.g. e-shop dating with no e-shop connector). */
  disabled?: boolean;
}

export interface SourceRoleSettingCardProps {
  /** brands/{brandId} field this card writes (e.g. 'revenuePerformanceSource'). */
  field: keyof Brand;
  title: string;
  tooltip?: string;
  options: SourceRoleOption[];
  /** Effective default id when the brand has not set the field (resolved by the parent). */
  defaultId: string;
  /** A one-line hint shown under the title explaining the active default. */
  defaultHint?: string;
  /** React-Query keys to invalidate after save (e.g. dashboard/ecommerce summaries). */
  invalidateKeys?: (brandId: string) => unknown[][];
}

export function SourceRoleSettingCard({
  field,
  title,
  tooltip,
  options,
  defaultId,
  defaultHint,
  invalidateKeys,
}: SourceRoleSettingCardProps) {
  const { currentBrand, refreshBrands } = useBrand();
  const queryClient = useQueryClient();
  const toast = useToast();

  const stored = (currentBrand?.[field] as string | undefined) ?? undefined;
  const effective = stored ?? defaultId;

  const [selected, setSelected] = useState<string>(effective);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSelected(((currentBrand?.[field] as string | undefined) ?? defaultId));
  }, [currentBrand?.id, currentBrand, field, defaultId]);

  const dirty = useMemo(() => selected !== effective, [selected, effective]);

  const handleSave = async () => {
    if (!currentBrand) return;
    setSaving(true);
    try {
      await FirestoreService.updateDocument('brands', currentBrand.id, { [field]: selected } as Partial<Brand>);
      await refreshBrands();
      for (const key of invalidateKeys?.(currentBrand.id) ?? []) {
        queryClient.invalidateQueries({ queryKey: key });
      }
      toast.success('Αποθηκεύτηκε.');
    } catch (err) {
      logger.error('[SourceRoleSettingCard] save failed:', { field, err });
      toast.error('Αποτυχία αποθήκευσης. Δοκιμάστε ξανά.');
    } finally {
      setSaving(false);
    }
  };

  if (!currentBrand) return null;

  return (
    <Card padding="lg">
      <div className="mb-4">
        <div className="flex items-center gap-1.5">
          <h3 className="text-base font-semibold text-[var(--nts-charcoal)]">{title}</h3>
          {tooltip && <Tooltip content={tooltip} size={13} />}
        </div>
        <p className="text-[12px] text-[var(--nts-medium-gray)] mt-1">
          Brand: <strong className="text-[var(--nts-charcoal)]">{currentBrand.name}</strong>
          {!stored && defaultHint && (
            <span className="ml-1 text-[var(--nts-medium-gray)]">· {defaultHint}</span>
          )}
        </p>
      </div>

      <div className="space-y-2">
        {options.map((opt) => {
          const isSelected = selected === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              disabled={opt.disabled}
              onClick={() => !opt.disabled && setSelected(opt.id)}
              className={[
                'w-full text-left p-3 rounded-lg border transition-all',
                'focus:outline-none focus:ring-2 focus:ring-[var(--nts-accent)] focus:ring-offset-1',
                isSelected
                  ? 'border-[var(--nts-accent)] bg-[var(--nts-accent)]/5'
                  : 'border-[var(--nts-border-gray)] hover:border-[var(--nts-medium-gray)] bg-white',
                opt.disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
              ].join(' ')}
            >
              <div className="flex items-start gap-3">
                <span
                  className={[
                    'mt-0.5 flex-shrink-0 w-4 h-4 rounded-full border-2',
                    isSelected
                      ? 'border-[var(--nts-accent)] bg-[var(--nts-accent)]'
                      : 'border-[var(--nts-border-gray)] bg-white',
                  ].join(' ')}
                  aria-hidden
                >
                  {isSelected && <span className="block w-1.5 h-1.5 m-[3px] rounded-full bg-white" />}
                </span>
                <div className="flex-1 min-w-0">
                  <span className="text-[13px] font-semibold text-[var(--nts-charcoal)]">{opt.label}</span>
                  <p className="text-[12px] text-[var(--nts-medium-gray)] leading-relaxed mt-0.5">{opt.description}</p>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-end gap-2 mt-4 pt-3 border-t border-[var(--nts-border-gray)]">
        {dirty && <span className="text-[11px] text-[var(--nts-medium-gray)]">Μη αποθηκευμένες αλλαγές</span>}
        <Button variant="primary" size="sm" disabled={!dirty || saving} onClick={handleSave}>
          {saving ? 'Αποθήκευση…' : 'Αποθήκευση'}
        </Button>
      </div>
    </Card>
  );
}
