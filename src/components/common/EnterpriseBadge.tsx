import { Lock, Sparkles } from 'lucide-react';

interface EnterpriseBadgeProps {
  inline?: boolean;
}

export function EnterpriseBadge({ inline }: EnterpriseBadgeProps) {
  if (inline) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-md bg-gradient-to-r from-[#7C3AED]/10 to-[#2563EB]/10 text-[#7C3AED] border border-[#7C3AED]/20">
        <Lock size={9} /> Enterprise
      </span>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
      <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#7C3AED]/10 to-[#2563EB]/10 flex items-center justify-center mb-4">
        <Sparkles size={24} className="text-[#7C3AED]" />
      </div>
      <h3 className="text-lg font-semibold text-[#111827] mb-1">Enterprise</h3>
      <p className="text-sm text-[#6B7280] max-w-sm mb-4">
        Αυτή η λειτουργία είναι διαθέσιμη στο Performance+ Enterprise.
        Αναβαθμίστε για πρόσβαση σε Procurement, ERP integrations, και προηγμένους αυτοματισμούς.
      </p>
      <button className="px-5 py-2 text-sm font-medium bg-gradient-to-r from-[#7C3AED] to-[#2563EB] text-white rounded-xl hover:opacity-90 transition-opacity">
        Μάθετε περισσότερα
      </button>
    </div>
  );
}
