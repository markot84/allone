import { useState } from 'react';
import { motion } from 'framer-motion';
import { Building2 } from 'lucide-react';
import { Button } from '../common';
import { useAuth } from '../../hooks';
import { FirestoreService } from '../../services/firestore';
import { MembersService } from '../../services/coordination';
import { BrandAssetUpload } from '../brands/BrandAssetUpload';
import { uploadBrandAsset } from '../../services/storage';
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
  const [logoFile, setLogoFile] = useState<File | null>(null);
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

      // 1. Create the brand doc first. storage.rules' isBrandMember check
      //    requires brands/{brandId}.createdBy == auth.uid, so the doc must
      //    exist before any asset upload is attempted.
      const brand: Brand = {
        id: brandId,
        name: trimmed,
        type: 'B2C',
        plan: 'growth',
        createdAt: new Date().toISOString(),
        createdBy: user.uid,
      };
      await FirestoreService.setDocument('brands', brandId, brand);

      // 2. Register the creator as owner-member before any asset upload, so
      //    storage.rules' membership check passes.
      await MembersService.set(brandId, {
        userId: user.uid,
        email: user.email ?? '',
        displayName: user.displayName || user.email || 'Owner',
        role: 'owner',
        department: 'management',
        departmentLabel: 'Διοίκηση',
        joinedAt: new Date().toISOString(),
      });

      // 3. Upload the logo (now that storage.rules can see the brand doc).
      //    A failed logo upload doesn't roll back the brand — surface the
      //    error and let the user retry from the brand-edit screen.
      let logoUrl = '';
      if (logoFile) {
        try {
          logoUrl = await uploadBrandAsset(logoFile, brandId, 'logo');
          await FirestoreService.setDocument('brands', brandId, { logoUrl });
        } catch (uploadErr) {
          setError(uploadErr instanceof Error
            ? `Brand created, αλλά το logo απέτυχε: ${uploadErr.message}`
            : 'Brand created, αλλά το logo απέτυχε.');
        }
      }

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
            placeholder="π.χ. My e-shop"
            className="w-full pl-10 pr-4 py-2.5 bg-[var(--nts-light-gray)] border border-transparent rounded-lg text-sm focus:outline-none focus:border-[var(--nts-accent)] focus:bg-white"
          />
        </div>
      </div>
      
      {/* Logo Upload — deferred. File is held in component state and uploaded
          inside handleSubmit after the brand doc exists, so storage.rules'
          isBrandMember(brandId) check can succeed via the createdBy clause. */}
      <BrandAssetUpload
        brandId={name.trim() ? sanitizeId(name.trim()) : 'temp'}
        onUploadComplete={() => {}}
        onFileSelected={setLogoFile}
        assetType="logo"
      />
      
      {error && <p className="text-sm text-[var(--danger-600)]">{error}</p>}
      <Button type="submit" variant="primary" className="w-full" disabled={submitting}>
        Δημιουργία Brand
      </Button>
    </motion.form>
  );
}
