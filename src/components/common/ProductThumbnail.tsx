import { useState } from 'react';
import { Package } from 'lucide-react';

type ProductThumbnailSize = 'sm' | 'md';

const SIZE_CLASS: Record<ProductThumbnailSize, string> = {
  sm: 'h-9 w-9',
  md: 'h-12 w-12',
};

interface ProductThumbnailProps {
  src?: string;
  alt?: string;
  size?: ProductThumbnailSize;
  className?: string;
}

export function ProductThumbnail({ src, alt = '', size = 'sm', className = '' }: ProductThumbnailProps) {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(src) && !failed;

  return (
    <div
      className={`relative shrink-0 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] ${SIZE_CLASS[size]} ${className}`}
    >
      {showImage ? (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-[var(--border-strong)]" aria-hidden>
          <Package size={size === 'sm' ? 16 : 20} strokeWidth={1.5} />
        </div>
      )}
    </div>
  );
}
