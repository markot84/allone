import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Building2,
  ArrowLeft,
  ArrowRight,
  Upload,
  BarChart3,
  Sparkles,
  CheckCircle,
  Package,
  Users,
  Target,
  Shield,
} from 'lucide-react';
import { Spinner, Button, AllOneLogo } from '../common';
import { BrandCreateForm } from './BrandCreateForm';
import { useAuth, useBrand } from '../../hooks';

interface BrandOnboardingProps {
  children: React.ReactNode;
}

type Step = 'welcome' | 'brand' | 'next-steps' | 'done';

const FEATURES = [
  { icon: Package, label: 'Product Intelligence', desc: 'Dead stock, αναπλήρωση, margins' },
  { icon: Users, label: 'RFM Segments', desc: 'Champions, At Risk, VIP ανάλυση' },
  { icon: Target, label: 'Campaign Analytics', desc: 'ROAS, ROI, performance tracking' },
  { icon: BarChart3, label: 'GA4 Analytics', desc: 'Traffic, conversions, bounce rate' },
  { icon: Shield, label: 'Automation Alerts', desc: 'Server-side ειδοποιήσεις 24/7' },
  { icon: Sparkles, label: 'AI Briefing', desc: 'Καθημερινή AI σύνοψη' },
];

export function BrandOnboarding({ children }: BrandOnboardingProps) {
  const { brands, loading, refreshBrands } = useBrand();
  const { signOut, user, isSuperAdmin } = useAuth();
  const [step, setStep] = useState<Step>('welcome');
  const [brandCreated, setBrandCreated] = useState(false);

  const handleBrandCreated = useCallback(() => {
    setBrandCreated(true);
    refreshBrands();
    setStep('next-steps');
  }, [refreshBrands]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--nts-light-gray)]">
        <Spinner size="lg" label="Φόρτωση…" />
      </div>
    );
  }

  // Super admin: enters the app directly even without a brand on their profile (e.g. management, invites).
  if (isSuperAdmin) return <>{children}</>;

  if (brands.length > 0 && !brandCreated) return <>{children}</>;
  if (brandCreated && step === 'done') return <>{children}</>;

  const handleBack = async () => {
    await signOut();
    window.location.href = '/';
  };

  const firstName = user?.displayName?.split(' ')[0] || '';

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: 'linear-gradient(135deg, #0f0f0f 0%, #1a1a2e 50%, #16213e 100%)' }}
    >
      <AnimatePresence mode="wait">
        {step === 'welcome' && (
          <motion.div
            key="welcome"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="w-full max-w-lg"
          >
            <div className="bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden">
              <div className="bg-gradient-to-r from-[#111] to-[#1a1a2e] p-8 text-center">
                <div className="flex justify-center mb-4">
                  <AllOneLogo height={44} className="mx-auto" variant="onDark" />
                </div>
                <h1 className="text-2xl font-bold text-white">
                  {firstName ? `Καλώς ήρθες, ${firstName}!` : 'Καλώς ήρθατε!'}
                </h1>
                <p className="text-white/60 mt-2 text-sm">
                  Το allone είναι η AI-powered πλατφόρμα διαχείρισης e-commerce σας.
                </p>
              </div>

              <div className="p-6">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Τι θα βρείτε εδώ</h3>
                <div className="grid grid-cols-2 gap-3">
                  {FEATURES.map(({ icon: Icon, label, desc }) => (
                    <div key={label} className="flex items-start gap-3 p-3 rounded-lg bg-gray-50 border border-gray-100">
                      <div className="w-8 h-8 rounded-lg bg-white border border-gray-200 flex items-center justify-center flex-shrink-0">
                        <Icon size={16} className="text-[#F97316]" />
                      </div>
                      <div>
                        <p className="text-[13px] font-semibold text-gray-800">{label}</p>
                        <p className="text-[11px] text-gray-500 leading-snug">{desc}</p>
                      </div>
                    </div>
                  ))}
                </div>

                <Button
                  variant="primary"
                  className="w-full mt-6"
                  onClick={() => setStep('brand')}
                >
                  <span className="flex items-center justify-center gap-2">
                    Ας ξεκινήσουμε <ArrowRight size={16} />
                  </span>
                </Button>

                <p className="text-center text-xs text-gray-400 mt-3">
                  Ή περιμένετε πρόσκληση από τον διαχειριστή του brand σας.
                </p>
              </div>
            </div>

            <button
              onClick={handleBack}
              className="w-full mt-4 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium text-white/50 hover:text-white/80 transition-colors"
            >
              <ArrowLeft size={16} />
              Αποσύνδεση
            </button>
          </motion.div>
        )}

        {step === 'brand' && (
          <motion.div
            key="brand"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="w-full max-w-md"
          >
            <div className="bg-white rounded-2xl shadow-2xl border border-gray-100 p-8">
              <StepIndicator current={1} total={3} />
              <div className="text-center mb-6">
                <div className="w-14 h-14 bg-gray-50 rounded-xl flex items-center justify-center mx-auto mb-4 border border-gray-200">
                  <Building2 size={28} className="text-[#F97316]" />
                </div>
                <h2 className="text-xl font-bold text-gray-900">Δημιουργία Brand</h2>
                <p className="text-gray-500 text-sm mt-1">Αυτό θα είναι το κεντρικό σας workspace.</p>
              </div>
              <BrandCreateForm onCreated={handleBrandCreated} />
              <button
                onClick={() => setStep('welcome')}
                className="w-full mt-4 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium text-gray-400 hover:text-gray-600 transition-colors"
              >
                <ArrowLeft size={16} />
                Πίσω
              </button>
            </div>
          </motion.div>
        )}

        {step === 'next-steps' && (
          <motion.div
            key="next-steps"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="w-full max-w-md"
          >
            <div className="bg-white rounded-2xl shadow-2xl border border-gray-100 p-8">
              <StepIndicator current={2} total={3} />
              <div className="text-center mb-6">
                <div className="w-14 h-14 bg-green-50 rounded-xl flex items-center justify-center mx-auto mb-4 border border-green-200">
                  <CheckCircle size={28} className="text-green-600" />
                </div>
                <h2 className="text-xl font-bold text-gray-900">Brand δημιουργήθηκε!</h2>
                <p className="text-gray-500 text-sm mt-1">Προτεινόμενα επόμενα βήματα:</p>
              </div>

              <div className="space-y-3 mb-6">
                <NextStepCard
                  icon={Upload}
                  title="Εισαγωγή Δεδομένων"
                  desc="Ανεβάστε προϊόντα, καμπάνιες ή RFM segments (CSV/Excel)"
                  section="data"
                />
                <NextStepCard
                  icon={BarChart3}
                  title="Σύνδεση Google Analytics"
                  desc="Συνδέστε GA4 για traffic & conversion analytics"
                  section="data"
                />
                <NextStepCard
                  icon={Target}
                  title="Σύνδεση Google Ads / Meta"
                  desc="Αυτόματο sync καμπανιών"
                  section="data"
                />
              </div>

              <Button
                variant="primary"
                className="w-full"
                onClick={() => setStep('done')}
              >
                <span className="flex items-center justify-center gap-2">
                  Μπείτε στο Dashboard <ArrowRight size={16} />
                </span>
              </Button>

              <p className="text-center text-xs text-gray-400 mt-3">
                Μπορείτε να κάνετε εισαγωγή δεδομένων ανά πάσα στιγμή από το μενού.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center justify-center gap-2 mb-6">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={`h-1.5 rounded-full transition-all duration-300 ${
            i + 1 <= current ? 'w-8 bg-[#F97316]' : 'w-4 bg-gray-200'
          }`}
        />
      ))}
    </div>
  );
}

function NextStepCard({ icon: Icon, title, desc }: {
  icon: React.ElementType;
  title: string;
  desc: string;
  section: string;
}) {
  return (
    <div className="flex items-start gap-3 p-3 rounded-lg border border-gray-100 bg-gray-50 hover:bg-gray-100 transition-colors">
      <div className="w-9 h-9 rounded-lg bg-white border border-gray-200 flex items-center justify-center flex-shrink-0">
        <Icon size={18} className="text-gray-600" />
      </div>
      <div>
        <p className="text-[13px] font-semibold text-gray-800">{title}</p>
        <p className="text-[11px] text-gray-500 leading-snug">{desc}</p>
      </div>
    </div>
  );
}
