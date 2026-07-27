import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Building2, Plus, ChevronRight, Edit3, Loader2, Save, X } from 'lucide-react';
import { Card, Button, PageHeader, Spinner } from '../common';
import { useBrand } from '../../hooks/useBrand';
import { useAuth } from '../../hooks';
import { BrandCreateForm } from '../auth/BrandCreateForm';
import { BrandAssetUpload } from './BrandAssetUpload';
import { getAssetUrl } from '../../services/storage';
import { FirestoreService } from '../../services/firestore';
import { MembersService } from '../../services/coordination';
import type { Brand } from '../../types';

const COLORS = ['var(--nts-accent)', '#78716C', '#22C55E', '#8B5CF6', '#F59E0B'];

interface BrandsPageProps {
  onNavigateToDashboard?: () => void;
}

export function BrandsPage({ onNavigateToDashboard }: BrandsPageProps) {
  const { brands, currentBrand, loading, setCurrentBrand, refreshBrands } = useBrand();
  const { user, isSuperAdmin } = useAuth();
  const [showAddForm, setShowAddForm] = useState(false);
  const [editableBrands, setEditableBrands] = useState<Record<string, boolean>>({});
  const [editingBrandId, setEditingBrandId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editType, setEditType] = useState<Brand['type']>('B2C');
  const [editLogoUrl, setEditLogoUrl] = useState('');
  const [editError, setEditError] = useState('');
  const [savingBrand, setSavingBrand] = useState(false);

  useEffect(() => {
    if (!user?.uid || brands.length === 0) {
      setEditableBrands({});
      return;
    }
    let active = true;
    const loadEditableBrands = async () => {
      const entries = await Promise.all(
        brands.map(async (brand) => {
          if (isSuperAdmin || brand.createdBy === user.uid) return [brand.id, true] as const;
          const member = await MembersService.get(brand.id, user.uid).catch(() => null);
          return [brand.id, member?.role === 'owner' || member?.role === 'admin'] as const;
        })
      );
      if (active) setEditableBrands(Object.fromEntries(entries));
    };
    void loadEditableBrands();
    return () => {
      active = false;
    };
  }, [brands, isSuperAdmin, user?.uid]);

  const handleBrandSelect = (brand: Brand) => {
    setCurrentBrand(brand);
    onNavigateToDashboard?.();
  };

  const startEditing = (brand: Brand) => {
    setEditingBrandId(brand.id);
    setEditName(brand.name || '');
    setEditType(brand.type || 'B2C');
    setEditLogoUrl(brand.logoUrl || '');
    setEditError('');
  };

  const cancelEditing = () => {
    setEditingBrandId(null);
    setEditError('');
    setSavingBrand(false);
  };

  const saveBrandProfile = async (brand: Brand) => {
    const nextName = editName.trim();
    if (!nextName) {
      setEditError('Το όνομα brand είναι υποχρεωτικό');
      return;
    }
    setSavingBrand(true);
    setEditError('');
    try {
      const updatedBrand: Brand = {
        ...brand,
        name: nextName,
        type: editType,
        logoUrl: editLogoUrl.trim() || undefined,
      };
      await FirestoreService.updateDocument<Brand>('brands', brand.id, {
        name: updatedBrand.name,
        type: updatedBrand.type,
        logoUrl: updatedBrand.logoUrl || '',
      });
      if (currentBrand?.id === brand.id) setCurrentBrand(updatedBrand);
      await refreshBrands();
      setEditingBrandId(null);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Δεν αποθηκεύτηκαν οι αλλαγές');
    } finally {
      setSavingBrand(false);
    }
  };

  const handleCreated = () => {
    setShowAddForm(false);
    refreshBrands();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        toolbarAriaLabel="Brand"
        title={<h2 className="text-xl font-bold text-[#1A1A1A] sm:text-2xl">Τα Brands μου</h2>}
        description={
          <p className="text-sm text-[#4A4A4A] sm:text-base">
            Επιλέξτε brand για να δείτε τα δεδομένα και την ανάλυσή του
          </p>
        }
        actions={
          <Button
            variant="primary"
            size="sm"
            icon={<Plus size={14} />}
            onClick={() => setShowAddForm(!showAddForm)}
            className="min-h-[36px] w-full sm:w-auto"
          >
            {showAddForm ? 'Ακύρωση' : 'Νέο Brand'}
          </Button>
        }
      />

      {showAddForm && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          className="overflow-hidden"
        >
          <Card padding="lg" className="border-l-4 border-l-[var(--nts-accent)]">
            <h3 className="font-semibold text-[#1A1A1A] mb-4">Δημιουργία νέου brand</h3>
            <BrandCreateForm onCreated={handleCreated} />
          </Card>
        </motion.div>
      )}

      {loading ? (
        <Card padding="lg" className="py-12">
          <div className="flex justify-center">
            <Spinner size="md" label="Φόρτωση brands..." />
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {brands.map((brand, index) => {
            const isEditing = editingBrandId === brand.id;
            const canEdit = editableBrands[brand.id] === true;
            return (
          <motion.div
            key={brand.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(index, 8) * 0.03 }}
          >
            <Card
              padding="md"
              hover
              className={`cursor-pointer transition-all ${
                currentBrand?.id === brand.id
                  ? 'ring-2 ring-[var(--nts-accent)] bg-[var(--nts-light-gray)]'
                  : ''
              }`}
              onClick={() => {
                if (!isEditing) handleBrandSelect(brand);
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  {brand.logoUrl ? (
                    <div className="w-12 h-12 rounded-xl overflow-hidden border-2 border-[var(--nts-border-gray)] bg-white flex items-center justify-center flex-shrink-0">
                      <img
                        src={getAssetUrl(brand.logoUrl) || brand.logoUrl}
                        alt={brand.name}
                        className="w-full h-full object-contain"
                        onError={(e) => {
                          const target = e.target as HTMLImageElement;
                          target.style.display = 'none';
                          const parent = target.parentElement;
                          if (parent) {
                            parent.innerHTML = `<div class="w-full h-full flex items-center justify-center" style="background-color: ${COLORS[index % COLORS.length]}"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2L2 7L12 12L22 7L12 2Z" fill="white"/><path d="M2 17L12 22L22 17M2 12L12 17L22 12" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></div>`;
                          }
                        }}
                      />
                    </div>
                  ) : (
                    <div
                      className="w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold flex-shrink-0"
                      style={{ backgroundColor: COLORS[index % COLORS.length] }}
                    >
                      <Building2 size={24} />
                    </div>
                  )}
                  <div className="min-w-0">
                    <h3 className="font-semibold text-[#1A1A1A] truncate">{brand.name}</h3>
                    {brand.type && (
                      <p className="text-sm text-[#4A4A4A]">{brand.type}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {canEdit && (
                    <button
                      type="button"
                      aria-label={`Επεξεργασία ${brand.name}`}
                      className="rounded-lg p-2 text-[#6B7280] transition-colors hover:bg-white hover:text-[var(--nts-accent)]"
                      onClick={(e) => {
                        e.stopPropagation();
                        startEditing(brand);
                      }}
                    >
                      <Edit3 size={16} />
                    </button>
                  )}
                  <ChevronRight
                    size={20}
                    className={`flex-shrink-0 ${
                      currentBrand?.id === brand.id ? 'text-[var(--nts-accent)]' : 'text-[#9CA3AF]'
                    }`}
                  />
                </div>
              </div>
              {isEditing && (
                <form
                  className="mt-4 space-y-3 border-t border-[var(--nts-border-gray)] pt-4"
                  onClick={(e) => e.stopPropagation()}
                  onSubmit={(e) => {
                    e.preventDefault();
                    void saveBrandProfile(brand);
                  }}
                >
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-[var(--nts-charcoal)]">
                      Όνομα Brand
                    </label>
                    <input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="w-full rounded-lg border border-transparent bg-[var(--nts-light-gray)] px-3 py-2 text-sm focus:border-[var(--nts-accent)] focus:bg-white focus:outline-none"
                      placeholder="π.χ. Stepsport"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-[var(--nts-charcoal)]">
                      Τύπος Brand
                    </label>
                    <select
                      value={editType}
                      onChange={(e) => setEditType(e.target.value as Brand['type'])}
                      className="w-full rounded-lg border border-transparent bg-[var(--nts-light-gray)] px-3 py-2 text-sm focus:border-[var(--nts-accent)] focus:bg-white focus:outline-none"
                    >
                      <option value="B2C">B2C</option>
                      <option value="B2B">B2B</option>
                    </select>
                  </div>
                  <BrandAssetUpload
                    brandId={brand.id}
                    currentLogoUrl={editLogoUrl}
                    onUploadComplete={setEditLogoUrl}
                    assetType="logo"
                    label="Logo Brand"
                  />
                  {editError && <p className="text-sm text-[#EF4444]">{editError}</p>}
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Button
                      type="submit"
                      variant="primary"
                      size="sm"
                      disabled={savingBrand}
                      icon={savingBrand ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                      className="w-full sm:w-auto"
                    >
                      Αποθήκευση
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={savingBrand}
                      icon={<X size={14} />}
                      onClick={cancelEditing}
                      className="w-full sm:w-auto"
                    >
                      Ακύρωση
                    </Button>
                  </div>
                </form>
              )}
              {currentBrand?.id === brand.id && (
                <p className="text-xs text-[var(--nts-accent)] font-medium mt-2">Ενεργό brand</p>
              )}
            </Card>
          </motion.div>
          );
          })}
        </div>
      )}

      {!loading && brands.length === 0 && !showAddForm && (
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
