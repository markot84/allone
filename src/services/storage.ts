// Firebase Storage Service for Brand Assets
import { ref, uploadBytes, getDownloadURL, deleteObject, listAll } from 'firebase/storage';
import { storage } from '../config/firebase';
import { logger } from '../utils/logger';

export interface UploadProgress {
  bytesTransferred: number;
  totalBytes: number;
  percentage: number;
}

/**
 * Upload brand asset (logo, images, etc.) to Firebase Storage
 * @param file - File to upload
 * @param brandId - Brand ID
 * @param assetType - Type of asset (logo, image, etc.)
 * @returns Download URL
 */
export async function uploadBrandAsset(
  file: File,
  brandId: string,
  assetType: 'logo' | 'image' | 'document' = 'image'
): Promise<string> {
  try {
    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/svg+xml', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(file.type) && assetType !== 'document') {
      throw new Error('Μη υποστηριζόμενος τύπος αρχείου. Χρησιμοποιήστε: JPEG, PNG, SVG, WebP, GIF');
    }

    // Validate file size (max 5MB)
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSize) {
      throw new Error('Το αρχείο είναι πολύ μεγάλο. Μέγιστο μέγεθος: 5MB');
    }

    // Create storage path: brands/{brandId}/assets/{assetType}/{timestamp}-{filename}
    const timestamp = Date.now();
    const sanitizedFilename = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    const storagePath = `brands/${brandId}/assets/${assetType}/${timestamp}-${sanitizedFilename}`;
    const storageRef = ref(storage, storagePath);

    // Upload file
    await uploadBytes(storageRef, file);

    // Get download URL
    const downloadURL = await getDownloadURL(storageRef);

    return downloadURL;
  } catch (error) {
    logger.error('Error uploading brand asset:', { err: error });
    throw error instanceof Error ? error : new Error('Σφάλμα ανέβασματος αρχείου');
  }
}

/**
 * Delete brand asset from Firebase Storage
 * @param url - Download URL of the asset to delete
 */
export async function deleteBrandAsset(url: string): Promise<void> {
  try {
    // Extract path from URL
    const urlObj = new URL(url);
    const pathMatch = urlObj.pathname.match(/\/o\/(.+)\?/);
    if (!pathMatch) {
      throw new Error('Invalid storage URL');
    }

    // Decode the path (Firebase Storage URLs are encoded)
    const decodedPath = decodeURIComponent(pathMatch[1]);
    const storageRef = ref(storage, decodedPath);

    await deleteObject(storageRef);
  } catch (error) {
    logger.error('Error deleting brand asset:', { err: error });
    throw error instanceof Error ? error : new Error('Σφάλμα διαγραφής αρχείου');
  }
}

/**
 * Get all assets for a brand
 * @param brandId - Brand ID
 * @param assetType - Optional filter by asset type
 * @returns Array of download URLs
 */
export async function getBrandAssets(
  brandId: string,
  assetType?: 'logo' | 'image' | 'document'
): Promise<string[]> {
  try {
    const path = assetType 
      ? `brands/${brandId}/assets/${assetType}`
      : `brands/${brandId}/assets`;
    
    const storageRef = ref(storage, path);
    const result = await listAll(storageRef);

    const urls: string[] = [];
    for (const itemRef of result.items) {
      const url = await getDownloadURL(itemRef);
      urls.push(url);
    }

    return urls;
  } catch (error) {
    logger.error('Error getting brand assets:', { err: error });
    return [];
  }
}

/**
 * Get asset URL - works for both localhost and production
 * If URL is already a full URL, returns as-is
 * If URL is a relative path, constructs full URL
 */
export function getAssetUrl(url: string | undefined | null): string | null {
  if (!url) return null;
  
  // If already a full URL (http/https), return as-is
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  
  // If Firebase Storage URL, return as-is
  if (url.includes('firebasestorage.googleapis.com') || url.includes('firebase')) {
    return url;
  }
  
  // If relative path, construct URL based on environment
  // In production, assets are served from Firebase Storage
  // In development, you might want to serve from public folder
  if (url.startsWith('/')) {
    // Remove leading slash and construct URL
    const cleanPath = url.substring(1);
    return `${window.location.origin}/${cleanPath}`;
  }
  
  return url;
}
