import { useState, useRef } from 'react';
import { Upload, X, Loader2, CheckCircle2 } from 'lucide-react';
import { Button } from '../common';
import { uploadBrandAsset, getAssetUrl } from '../../services/storage';
import { useToast } from '../common/Toast';

interface BrandAssetUploadProps {
  brandId: string;
  currentLogoUrl?: string;
  onUploadComplete: (url: string) => void;
  assetType?: 'logo' | 'image';
  label?: string;
  // Defer the upload: don't write to Storage on file pick. Used by flows that
  // must create the brand Firestore doc first (storage.rules' isBrandMember
  // check would otherwise fail). When set, `onFileSelected` receives the
  // validated File and the parent is responsible for uploading later.
  onFileSelected?: (file: File | null) => void;
}

export function BrandAssetUpload({
  brandId,
  currentLogoUrl,
  onUploadComplete,
  assetType = 'logo',
  label,
  onFileSelected
}: BrandAssetUploadProps) {
  const deferUpload = typeof onFileSelected === 'function';
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(currentLogoUrl || null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { success, error: showError } = useToast();

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/svg+xml', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(file.type)) {
      showError('Μη υποστηριζόμενος τύπος αρχείου. Χρησιμοποιήστε: JPEG, PNG, SVG, WebP, GIF');
      return;
    }

    // Validate file size (max 5MB)
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      showError('Το αρχείο είναι πολύ μεγάλο. Μέγιστο μέγεθος: 5MB');
      return;
    }

    // Create preview
    const reader = new FileReader();
    reader.onloadend = () => {
      setPreview(reader.result as string);
    };
    reader.readAsDataURL(file);

    if (deferUpload) {
      onFileSelected?.(file);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      return;
    }

    // Upload to Firebase Storage
    setUploading(true);
    try {
      const downloadURL = await uploadBrandAsset(file, brandId, assetType);
      setPreview(downloadURL);
      onUploadComplete(downloadURL);
      success('Το asset ανέβηκε επιτυχώς');
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Σφάλμα ανέβασματος');
      setPreview(currentLogoUrl || null);
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleRemove = () => {
    setPreview(null);
    onUploadComplete('');
    if (deferUpload) {
      onFileSelected?.(null);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const displayLabel = label || (assetType === 'logo' ? 'Logo Brand' : 'Εικόνα');

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-[var(--nts-charcoal)]">
        {displayLabel}
      </label>
      
      {/* Preview */}
      {preview && (
        <div className="relative inline-block">
          <div className="w-24 h-24 rounded-lg border-2 border-[var(--nts-border-gray)] overflow-hidden bg-[var(--nts-light-gray)] flex items-center justify-center">
            <img
              src={getAssetUrl(preview) || preview}
              alt={displayLabel}
              className="w-full h-full object-contain"
              onError={(e) => {
                const target = e.target as HTMLImageElement;
                target.style.display = 'none';
                const parent = target.parentElement;
                if (parent) {
                  parent.innerHTML = '<ImageIcon size={32} className="text-[var(--nts-medium-gray)]" />';
                }
              }}
            />
          </div>
          {!uploading && (
            <button
              type="button"
              onClick={handleRemove}
              className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600 transition-colors"
            >
              <X size={14} />
            </button>
          )}
        </div>
      )}

      {/* Upload Button */}
      <div className="flex items-center gap-2">
        <input
          id={`brand-asset-${assetType}`}
          name={`brand-asset-${assetType}`}
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/svg+xml,image/webp,image/gif"
          onChange={handleFileSelect}
          className="hidden"
          disabled={uploading}
        />
        <Button
          type="button"
          variant="secondary"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          icon={uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
        >
          {uploading ? 'Ανέβασμα...' : preview ? 'Αλλαγή' : 'Ανέβασμα'}
        </Button>
        {preview && !uploading && (
          <span className="text-xs text-[var(--success-700)] flex items-center gap-1">
            <CheckCircle2 size={12} />
            Ανέβηκε
          </span>
        )}
      </div>

      <p className="text-xs text-[var(--nts-medium-gray)]">
        Μέγιστο μέγεθος: 5MB. Υποστηριζόμενοι τύποι: JPEG, PNG, SVG, WebP, GIF
      </p>
    </div>
  );
}
