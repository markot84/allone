import { motion } from 'framer-motion';
import { Building2 } from 'lucide-react';
import { Spinner } from '../common';
import { BrandCreateForm } from './BrandCreateForm';
import { useBrand } from '../../hooks';

interface BrandOnboardingProps {
  children: React.ReactNode;
}

export function BrandOnboarding({ children }: BrandOnboardingProps) {
  const { brands, loading, refreshBrands } = useBrand();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--nts-light-gray)]">
        <Spinner size="lg" label="Φόρτωση…" />
      </div>
    );
  }
  if (brands.length > 0) return <>{children}</>;

  return (
    <div
      className="min-h-screen flex items-center justify-center bg-[var(--nts-light-gray)] p-4"
      style={{ background: 'linear-gradient(135deg, #f6f8fa 0%, #e9ecef 100%)' }}
    >
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        <div className="bg-white rounded-2xl shadow-lg border border-[var(--nts-border-gray)] p-8">
          <div className="text-center mb-8">
            <div className="w-14 h-14 bg-[#FFF0EB] rounded-xl flex items-center justify-center mx-auto mb-4">
              <Building2 size={28} className="text-[#FF6B35]" />
            </div>
            <h1 className="text-2xl font-bold text-[var(--nts-charcoal)]">Δημιούργησε το πρώτο σου Brand</h1>
            <p className="text-[var(--nts-medium-gray)] mt-1">
              Οι εισαγωγές δεδομένων και η ανάλυση θα συσχετίζονται με αυτό το brand.
            </p>
            <p className="text-sm text-[var(--nts-medium-gray)] mt-2">
              Ή περίμενε να δεχτείς πρόσκληση από άλλον χρήστη.
            </p>
          </div>
          <BrandCreateForm onCreated={refreshBrands} />
        </div>
      </motion.div>
    </div>
  );
}
