import { useState, useEffect, useCallback } from 'react';
import { Key, Copy, Trash2, Plus, Check, Eye, EyeOff, Code, ExternalLink } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, Button, Badge, Spinner, useToast, PageHeader } from '../common';
import { useBrand, useAuth } from '../../hooks';
import { FirestoreService } from '../../services/firestore';

interface ApiKeyDoc {
  id: string;
  key: string;
  brandId: string;
  active: boolean;
  createdBy: string;
  createdAt: { seconds: number } | string;
}

const IMPORT_ENDPOINT = 'https://importdata-edvzr6unva-ew.a.run.app';

export function ApiKeyManager() {
  const { currentBrand } = useBrand();
  const { user } = useAuth();
  const toast = useToast();
  const brandId = currentBrand?.id;

  const [keys, setKeys] = useState<ApiKeyDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showDocs, setShowDocs] = useState(false);

  const fetchKeys = useCallback(async () => {
    if (!brandId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const docs = await FirestoreService.getDocuments<ApiKeyDoc>('api_keys', [], brandId);
      setKeys(docs);
    } catch (err) {
      console.error('[ApiKeyManager] Fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  const generateUniqueKey = () => {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = 'pp_';
    for (let i = 0; i < 32; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  };

  const handleGenerate = async () => {
    if (!brandId || !user) return;
    setGenerating(true);
    try {
      const key = generateUniqueKey();
      const docId = `key_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      await FirestoreService.setDocument('api_keys', docId, {
        key,
        brandId,
        active: true,
        createdBy: user.uid || user.email || 'unknown',
      } as Record<string, unknown>);

      toast.success('API Key δημιουργήθηκε');
      setRevealedKeys((prev) => new Set(prev).add(key));
      await fetchKeys();
    } catch (err) {
      console.error('[ApiKeyManager] Generate error:', err);
      toast.error('Σφάλμα κατά τη δημιουργία API key');
    } finally {
      setGenerating(false);
    }
  };

  const handleRevoke = async (doc: ApiKeyDoc) => {
    try {
      await FirestoreService.updateDocument('api_keys', doc.id, { active: false });
      toast.success('API Key απενεργοποιήθηκε');
      await fetchKeys();
    } catch (err) {
      console.error('[ApiKeyManager] Revoke error:', err);
      toast.error('Σφάλμα');
    }
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    toast.success('Copied!');
    setTimeout(() => setCopiedId(null), 2000);
  };

  const toggleReveal = (key: string) => {
    setRevealedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const maskKey = (key: string) => `${key.slice(0, 6)}${'•'.repeat(20)}${key.slice(-4)}`;

  const formatDate = (ts: { seconds: number } | string) => {
    if (!ts) return '—';
    const d = typeof ts === 'string' ? new Date(ts) : new Date(ts.seconds * 1000);
    return d.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  const activeKeys = keys.filter((k) => k.active);
  const revokedKeys = keys.filter((k) => !k.active);

  return (
    <Card>
      <div className="p-6">
        <PageHeader
          className="mb-4"
          toolbarAriaLabel="API keys"
          title={
            <div className="flex flex-wrap items-center gap-2">
              <Key size={20} className="shrink-0 text-[var(--nts-accent)]" />
              <h3 className="text-base font-semibold text-[#1A1A1A] sm:text-lg">API Keys</h3>
              <Badge variant="info" size="sm">
                Automated Import
              </Badge>
            </div>
          }
          description={
            <p className="text-sm text-[var(--nts-medium-gray)]">
              Χρησιμοποίησε API keys για αυτόματη εισαγωγή δεδομένων από ERP ή άλλα συστήματα μέσω HTTP request.
            </p>
          }
          actions={
            <>
              <button
                type="button"
                onClick={() => setShowDocs(!showDocs)}
                className="inline-flex min-h-[36px] w-full items-center justify-center gap-1 rounded-lg px-2 text-xs text-[var(--nts-accent)] hover:underline sm:w-auto sm:justify-start"
              >
                <Code size={12} className="shrink-0" />
                {showDocs ? 'Κλείσιμο docs' : 'API Documentation'}
              </button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleGenerate}
                disabled={generating || !brandId}
                className="min-h-[36px] w-full sm:w-auto"
              >
                {generating ? <Spinner size="sm" /> : <Plus size={14} className="mr-1" />}
                Νέο Key
              </Button>
            </>
          }
        />

        {/* API Docs */}
        <AnimatePresence>
          {showDocs && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mb-4"
            >
              <div className="bg-[#1A1A1A] rounded-xl p-5 text-sm font-mono space-y-4">
                <div>
                  <p className="text-emerald-400 mb-1"># Upload αρχείου (CSV/XLSX)</p>
                  <p className="text-gray-300">
                    curl -X POST {IMPORT_ENDPOINT} \
                  </p>
                  <p className="text-gray-400 pl-4">
                    -H "Authorization: Bearer <span className="text-amber-300">YOUR_API_KEY</span>" \
                  </p>
                  <p className="text-gray-400 pl-4">
                    -F "file=@products.xlsx" \
                  </p>
                  <p className="text-gray-400 pl-4">
                    -F "type=products"
                  </p>
                </div>
                <div className="border-t border-gray-700 pt-3">
                  <p className="text-emerald-400 mb-1"># Import από URL</p>
                  <p className="text-gray-300">
                    curl -X POST {IMPORT_ENDPOINT} \
                  </p>
                  <p className="text-gray-400 pl-4">
                    -H "Authorization: Bearer <span className="text-amber-300">YOUR_API_KEY</span>" \
                  </p>
                  <p className="text-gray-400 pl-4">
                    -H "Content-Type: application/json" \
                  </p>
                  <p className="text-gray-400 pl-4">
                    -d '{`{"fileUrl":"https://erp.example.com/export.xlsx","type":"products"}`}'
                  </p>
                </div>
                <div className="border-t border-gray-700 pt-3 text-gray-500 text-xs">
                  <p><span className="text-gray-400">type:</span> "products" | "campaigns"</p>
                  <p><span className="text-gray-400">channel:</span> (optional) "Google Ads" | "Meta" — force campaign channel</p>
                  <p><span className="text-gray-400">Response:</span> {`{"success":true,"imported":150,"failed":2,"errors":[...]}`}</p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Keys list */}
        {loading ? (
          <div className="py-8 text-center">
            <Spinner size="md" />
          </div>
        ) : activeKeys.length === 0 ? (
          <div className="py-8 text-center text-[var(--nts-medium-gray)]">
            <Key size={32} className="mx-auto mb-2 opacity-20" />
            <p className="text-sm">Δεν υπάρχουν ενεργά API keys</p>
            <p className="text-xs mt-1">Δημιούργησε ένα για να ξεκινήσεις αυτόματα imports</p>
          </div>
        ) : (
          <div className="space-y-2">
            {activeKeys.map((k) => (
              <div
                key={k.id}
                className="flex items-center gap-3 p-3 border border-[#E5E5E5] rounded-lg bg-white hover:border-[var(--nts-accent)]/30 transition-colors"
              >
                <div className="w-8 h-8 rounded-md bg-emerald-50 flex items-center justify-center shrink-0">
                  <Key size={14} className="text-emerald-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-mono text-[#1A1A1A] truncate">
                    {revealedKeys.has(k.key) ? k.key : maskKey(k.key)}
                  </p>
                  <p className="text-[10px] text-[var(--nts-medium-gray)]">
                    Δημιουργήθηκε: {formatDate(k.createdAt)}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => toggleReveal(k.key)}
                    className="p-1.5 text-[var(--nts-medium-gray)] hover:text-[var(--nts-charcoal)] hover:bg-gray-50 rounded"
                    title={revealedKeys.has(k.key) ? 'Απόκρυψη' : 'Εμφάνιση'}
                  >
                    {revealedKeys.has(k.key) ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                  <button
                    onClick={() => handleCopy(k.key, k.id)}
                    className="p-1.5 text-[var(--nts-medium-gray)] hover:text-[var(--nts-accent)] hover:bg-gray-50 rounded"
                    title="Αντιγραφή"
                  >
                    {copiedId === k.id ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                  </button>
                  <button
                    onClick={() => handleRevoke(k)}
                    className="p-1.5 text-[var(--nts-medium-gray)] hover:text-red-500 hover:bg-red-50 rounded"
                    title="Απενεργοποίηση"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Revoked keys */}
        {revokedKeys.length > 0 && (
          <div className="mt-4 pt-4 border-t border-[#E5E5E5]">
            <p className="text-xs text-[var(--nts-medium-gray)] mb-2">Απενεργοποιημένα ({revokedKeys.length})</p>
            {revokedKeys.map((k) => (
              <div key={k.id} className="flex items-center gap-3 p-2 opacity-40">
                <Key size={12} className="text-gray-400" />
                <span className="text-xs font-mono text-gray-400 line-through">{maskKey(k.key)}</span>
              </div>
            ))}
          </div>
        )}

        {/* Endpoint info */}
        <div className="mt-4 pt-4 border-t border-[#E5E5E5]">
          <div className="flex items-center gap-2 text-xs text-[var(--nts-medium-gray)]">
            <ExternalLink size={12} />
            <span>Endpoint:</span>
            <code
              className="bg-gray-50 px-2 py-0.5 rounded text-[11px] cursor-pointer hover:bg-gray-100"
              onClick={() => handleCopy(IMPORT_ENDPOINT, 'endpoint')}
              title="Click to copy"
            >
              {IMPORT_ENDPOINT}
            </code>
            {copiedId === 'endpoint' && <span className="text-emerald-500 text-[10px]">Copied!</span>}
          </div>
        </div>
      </div>
    </Card>
  );
}
