import { useState } from 'react';
import { motion } from 'framer-motion';
import { Building2 } from 'lucide-react';
import { Button } from '../common';
import { useAuth } from '../../hooks';
import { FirestoreService } from '../../services/firestore';
import { BrandAssetUpload } from '../brands/BrandAssetUpload';
import type { Brand } from '../../types';

function sanitizeId(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '') || 'brand_' + Date.now();
}

interface BrandCreateFormProps {
  onCreated: () => void;
}

export function BrandCreateForm({ onCreated }: BrandCreateFormProps) {
  const { user } = useAuth();
  const [name, setName] = useState('');
  const [type, setType] = useState<'B2B' | 'B2C'>('B2C');
  const [logoUrl, setLogoUrl] = useState<string>('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Εισάγετε όνομα brand');
      return;
    }
    if (!user?.uid) return;
    setSubmitting(true);
    try {
      const brandId = sanitizeId(trimmed);
      
      const brand: Brand = {
        id: brandId,
        name: trimmed,
        type,
        createdAt: new Date().toISOString(),
        createdBy: user.uid,
        ...(logoUrl ? { logoUrl } : {}),
      };
      await FirestoreService.setDocument('brands', brandId, brand);
      const profile = await FirestoreService.getDocument<{ brandIds?: string[] }>('users', user.uid);
      const brandIds = profile?.brandIds ?? [];
      if (!brandIds.includes(brandId)) {
        // Use setDocument with merge to create user profile if it doesn't exist yet
        await FirestoreService.setDocument('users', user.uid, {
          id: user.uid,
          email: user.email ?? '',
          displayName: user.displayName ?? null,
          brandIds: [...brandIds, brandId],
          defaultBrandId: brandId,
        } as Record<string, unknown>);
      }
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Σφάλμα δημιουργίας');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <motion.form
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      onSubmit={handleSubmit}
      className="space-y-4"
    >
      <div>
        <label className="block text-sm font-medium text-[var(--nts-charcoal)] mb-1.5">Όνομα Brand</label>
        <div className="relative">
          <Building2 size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--nts-medium-gray)]" />
          <input
            id="brand-name"
            name="brand-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="π.χ. My Store"
            className="w-full pl-10 pr-4 py-2.5 bg-[var(--nts-light-gray)] border border-transparent rounded-lg text-sm focus:outline-none focus:border-[var(--nts-accent)] focus:bg-white"
          />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-[var(--nts-charcoal)] mb-1.5">Τύπος</label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setType('B2B')}
            className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all ${
              type === 'B2B' ? 'bg-[var(--nts-accent)] text-white' : 'bg-[var(--nts-light-gray)] text-[var(--nts-medium-gray)]'
            }`}
          >
            B2B
          </button>
          <button
            type="button"
            onClick={() => setType('B2C')}
            className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all ${
              type === 'B2C' ? 'bg-[var(--nts-accent)] text-white' : 'bg-[var(--nts-light-gray)] text-[var(--nts-medium-gray)]'
            }`}
          >
            B2C
          </button>
        </div>
      </div>
      
      {/* Logo Upload - Show upload field */}
      <BrandAssetUpload
        brandId={name.trim() ? sanitizeId(name.trim()) : 'temp'}
        currentLogoUrl={logoUrl}
        onUploadComplete={(url) => {
          setLogoUrl(url);
        }}
        assetType="logo"
      />
      
      {error && <p className="text-sm text-[#EF4444]">{error}</p>}
      <Button type="submit" variant="primary" className="w-full" disabled={submitting}>
        Δημιουργία Brand
      </Button>
    </motion.form>
  );
}
