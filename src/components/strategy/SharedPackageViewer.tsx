import { useEffect, useState } from 'react';
import { FileDown, Loader2 } from 'lucide-react';
import { FormattedProse } from '../common';
import { getSharedPackage, type SharedPackageData } from '../../services/strategyPackageShare';
import { openPackagePdf } from '../../services/strategyPackagePdf';

interface SharedPackageViewerProps {
  packageId: string;
}

function weightBar(label: string, value: number) {
  return (
    <div key={label} className="flex items-center gap-2 my-1">
      <span className="w-24 text-xs text-[#4A4A4A]">{label}</span>
      <div className="flex-1 h-1.5 bg-[#F5F5F5] rounded-full overflow-hidden">
        <div className="h-full bg-[var(--nts-accent)] rounded-full" style={{ width: `${value}%` }} />
      </div>
      <span className="text-xs font-semibold text-[#1A1A1A] w-9 text-right">{value}%</span>
    </div>
  );
}

export function SharedPackageViewer({ packageId }: SharedPackageViewerProps) {
  const [data, setData] = useState<SharedPackageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    getSharedPackage(packageId)
      .then(d => { setData(d); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });
  }, [packageId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 size={24} className="animate-spin text-[#9CA3AF]" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-center">
        <p className="text-lg font-semibold text-[#1A1A1A]">Δεν βρέθηκε</p>
        <p className="text-sm text-[#9CA3AF] mt-1">Το πακέτο στρατηγικής δεν είναι διαθέσιμο ή έχει λήξει.</p>
      </div>
    );
  }

  const sortedWeights = Object.entries(data.weights).sort((a, b) => b[1] - a[1]);

  return (
    <div className="max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-6 pb-4 border-b-2 border-[var(--nts-accent)]">
        <div>
          <h1 className="text-2xl font-bold text-[#1A1A1A]">{data.brandName || 'Strategy Package'}</h1>
          <p className="text-sm text-[#9CA3AF] mt-1">
            {data.createdAt?.toDate?.()
              ? data.createdAt.toDate().toLocaleDateString('el-GR', { day: 'numeric', month: 'long', year: 'numeric' })
              : ''}
          </p>
        </div>
        <button
          onClick={() => openPackagePdf(data)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-[#1A1A1A] text-white hover:bg-[#333] transition-colors"
        >
          <FileDown size={14} />
          PDF
        </button>
      </div>

      {/* Meta */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="p-4 rounded-xl bg-[#FAFAFA]">
          <p className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider">Στρατηγική</p>
          <p className="text-base font-semibold text-[#1A1A1A] mt-1">{data.strategyName}</p>
        </div>
        <div className="p-4 rounded-xl bg-[#FAFAFA]">
          <p className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider">Διάρκεια</p>
          <p className="text-base font-semibold text-[#1A1A1A] mt-1">{data.duration}</p>
        </div>
      </div>

      {/* Segments */}
      <div className="mb-6">
        <p className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-2 pb-1 border-b border-[#F5F5F5]">Segments</p>
        <div className="flex flex-wrap gap-1.5">
          {data.idealSegments.map(s => (
            <span key={s} className="px-2.5 py-1 rounded-full text-xs bg-[#F0FDF4] text-[#15803D] border border-[#BBF7D0]">{s}</span>
          ))}
          {data.goodSegments.map(s => (
            <span key={s} className="px-2.5 py-1 rounded-full text-xs bg-[#F5F5F5] text-[#4A4A4A] border border-dashed border-[#D1D5DB]">{s}</span>
          ))}
        </div>
      </div>

      {/* Weights */}
      <div className="mb-6">
        <p className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-2 pb-1 border-b border-[#F5F5F5]">Βάρη προτεραιοτήτων</p>
        {sortedWeights.map(([k, v]) => weightBar(k.charAt(0).toUpperCase() + k.slice(1), v))}
      </div>

      {/* Channels */}
      <div className="mb-6">
        <p className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-2 pb-1 border-b border-[#F5F5F5]">Κανάλια</p>
        <div className="space-y-1.5">
          {data.primaryChannels.map((ch, i) => (
            <div key={ch} className="flex justify-between items-center p-2.5 rounded-lg bg-[#FAFAFA]">
              <span className="text-sm text-[#1A1A1A]"><strong className="text-[var(--nts-accent)]">{i + 1}.</strong> {ch}</span>
            </div>
          ))}
          {data.secondaryChannels.map((ch, i) => (
            <div key={ch} className="flex justify-between items-center p-2 text-sm text-[#4A4A4A]">
              {data.primaryChannels.length + i + 1}. {ch}
            </div>
          ))}
        </div>
      </div>

      {/* Rationale */}
      {data.rationale && (
        <div className="mb-6">
          <p className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-2 pb-1 border-b border-[#F5F5F5]">AI ανάλυση</p>
          <div className="text-sm text-[#4A4A4A] leading-relaxed">
            <FormattedProse
              content={data.rationale.replace(/\|\|/g, '\n\n').replace(/—/g, ',')}
              variant="compact"
            />
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="pt-4 mt-6 border-t border-[#E5E5E5] flex justify-between items-center">
        <p className="text-[11px] text-[#9CA3AF]">Δημιουργήθηκε από Performance+ | notthesame.ai</p>
        <span className="text-lg font-bold text-[var(--nts-accent)]">≠</span>
      </div>
    </div>
  );
}
