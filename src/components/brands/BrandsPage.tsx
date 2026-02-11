import { useState } from 'react';
import { motion } from 'framer-motion';
import { Building2, Plus, ChevronRight } from 'lucide-react';
import { Card, Button } from '../common';
import { useBrand } from '../../hooks';
import { BrandCreateForm } from '../auth/BrandCreateForm';
import type { Brand } from '../../types';

const COLORS = ['#FF6B35', '#3B82F6', '#22C55E', '#8B5CF6', '#F59E0B'];

interface BrandsPageProps {
  onNavigateToDashboard?: () => void;
}

export function BrandsPage({ onNavigateToDashboard }: BrandsPageProps) {
  const { brands, currentBrand, setCurrentBrand, refreshBrands } = useBrand();
  const [showAddForm, setShowAddForm] = useState(false);

  const handleBrandSelect = (brand: Brand) => {
    setCurrentBrand(brand);
    onNavigateToDashboard?.();
  };

  const handleCreated = () => {
    setShowAddForm(false);
    refreshBrands();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-[#1A1A1A]">Τα Brands μου</h2>
          <p className="text-[#4A4A4A] mt-1">
            Επιλέξτε brand για να δείτε τα δεδομένα και την ανάλυσή του
          </p>
        </div>
        <Button
          variant="primary"
          icon={<Plus size={16} />}
          onClick={() => setShowAddForm(!showAddForm)}
        >
          {showAddForm ? 'Ακύρωση' : 'Νέο Brand'}
        </Button>
      </div>

      {showAddForm && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          className="overflow-hidden"
        >
          <Card padding="lg" className="border-l-4 border-l-[#FF6B35]">
            <h3 className="font-semibold text-[#1A1A1A] mb-4">Δημιουργία νέου brand</h3>
            <BrandCreateForm onCreated={handleCreated} />
          </Card>
        </motion.div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {brands.map((brand, index) => (
          <motion.div
            key={brand.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
          >
            <Card
              padding="md"
              hover
              className={`cursor-pointer transition-all ${
                currentBrand?.id === brand.id
                  ? 'ring-2 ring-[#FF6B35] bg-[#FFF0EB]'
                  : ''
              }`}
              onClick={() => handleBrandSelect(brand)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className="w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold flex-shrink-0"
                    style={{ backgroundColor: COLORS[index % COLORS.length] }}
                  >
                    <Building2 size={24} />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-semibold text-[#1A1A1A] truncate">{brand.name}</h3>
                    {brand.type && (
                      <p className="text-sm text-[#4A4A4A]">{brand.type}</p>
                    )}
                  </div>
                </div>
                <ChevronRight
                  size={20}
                  className={`flex-shrink-0 ${
                    currentBrand?.id === brand.id ? 'text-[#FF6B35]' : 'text-[#9CA3AF]'
                  }`}
                />
              </div>
              {currentBrand?.id === brand.id && (
                <p className="text-xs text-[#FF6B35] font-medium mt-2">Ενεργό brand</p>
              )}
            </Card>
          </motion.div>
        ))}
      </div>

      {brands.length === 0 && !showAddForm && (
        <Card padding="lg" className="text-center py-12">
          <Building2 size={48} className="mx-auto text-[#9CA3AF] mb-4" />
          <p className="text-[#4A4A4A] font-medium">Δεν έχετε brands ακόμη</p>
          <p className="text-sm text-[#4A4A4A] mt-1">
            Δημιουργήστε το πρώτο σας brand ή περίμενε πρόσκληση από άλλον χρήστη
          </p>
          <Button
            variant="primary"
            icon={<Plus size={16} />}
            className="mt-4"
            onClick={() => setShowAddForm(true)}
          >
            Δημιουργία Brand
          </Button>
        </Card>
      )}
    </div>
  );
}
