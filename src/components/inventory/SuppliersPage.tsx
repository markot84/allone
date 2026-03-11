import React, { useState, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Upload,
  Pencil,
  Check,
  X,
  Trash2,
  Search,
  Truck,
  Plus,
  FileSpreadsheet,
  Clock,
} from 'lucide-react';
import { Card, Button, Spinner, useToast } from '../common';
import { useSuppliers, useBrand, useProducts } from '../../hooks';
import { SuppliersService } from '../../services/firestore';
import { DEFAULT_TOD } from '../../utils/productUtils';
// format utility — currently unused but available for future formatting needs
import type { Supplier } from '../../types';
import * as XLSX from 'xlsx';

function sanitizeDocId(raw: string): string {
  return raw
    .replace(/[/\\#$.[\]]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 120);
}

export function SuppliersPage() {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;
  const { suppliers, isLoading, invalidate } = useSuppliers();
  const { products } = useProducts();
  // queryClient available for manual cache ops if needed
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTod, setEditTod] = useState<number>(DEFAULT_TOD);
  const [editLeadTime, setEditLeadTime] = useState<number>(0);
  const [isImporting, setIsImporting] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newTod, setNewTod] = useState(DEFAULT_TOD);
  const [newLeadTime, setNewLeadTime] = useState(0);
  const [newContact, setNewContact] = useState('');

  const productCountBySupplier = useMemo(() => {
    const map = new Map<string, number>();
    products.forEach(p => {
      const s = (p.supplier || '').trim();
      if (s) map.set(s, (map.get(s) || 0) + 1);
    });
    return map;
  }, [products]);

  const filteredSuppliers = useMemo(() => {
    if (!searchQuery.trim()) return suppliers;
    const q = searchQuery.toLowerCase();
    return suppliers.filter(s =>
      s.name.toLowerCase().includes(q) || (s.contact || '').toLowerCase().includes(q)
    );
  }, [suppliers, searchQuery]);

  const handleImportFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !brandId) return;
    setIsImporting(true);
    try {
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: '' });

      if (rows.length === 0) {
        toast.error('Κενό αρχείο');
        return;
      }

      const items: { id: string; data: Record<string, unknown> }[] = [];
      const pickCol = (row: Record<string, string>, ...alts: string[]) => {
        for (const alt of alts) {
          const key = Object.keys(row).find(k => k.toLowerCase().trim() === alt.toLowerCase());
          if (key && row[key] != null && String(row[key]).trim()) return String(row[key]).trim();
        }
        return '';
      };

      for (const row of rows) {
        const name = pickCol(row, 'supplier', 'name', 'supplier_name', 'vendor', 'vendor_name', 'προμηθευτής', 'όνομα');
        if (!name) continue;
        const todVal = parseInt(pickCol(row, 'tod', 'target_days', 'target_days_of_stock', 'days_of_stock', 'στόχος_ημερών') || String(DEFAULT_TOD), 10) || DEFAULT_TOD;
        const leadTime = parseInt(pickCol(row, 'lead_time', 'lead_time_days', 'delivery_days', 'χρόνος_παράδοσης') || '0', 10) || 0;
        const contact = pickCol(row, 'contact', 'email', 'phone', 'επικοινωνία');

        items.push({
          id: sanitizeDocId(name),
          data: { name, tod: todVal, lead_time: leadTime, contact },
        });
      }

      if (items.length === 0) {
        toast.error('Δεν βρέθηκαν εγγραφές προμηθευτών');
        return;
      }

      await SuppliersService.batchSet(items, brandId);
      await invalidate();
      toast.success(`${items.length} προμηθευτές εισήχθησαν`);
    } catch (err) {
      console.error('[SuppliersPage] Import error:', err);
      toast.error('Σφάλμα κατά την εισαγωγή');
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [brandId, invalidate, toast]);

  const handleStartEdit = (s: Supplier) => {
    setEditingId(s.id);
    setEditTod(s.tod);
    setEditLeadTime(s.lead_time || 0);
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;
    await SuppliersService.update(editingId, { tod: editTod, lead_time: editLeadTime });
    setEditingId(null);
    invalidate();
    toast.success('TOD ενημερώθηκε');
  };

  const handleDelete = async (id: string) => {
    await SuppliersService.delete(id);
    invalidate();
    toast.success('Προμηθευτής διαγράφηκε');
  };

  const handleAddSupplier = async () => {
    if (!newName.trim() || !brandId) return;
    const id = sanitizeDocId(newName.trim());
    await SuppliersService.create(id, {
      name: newName.trim(),
      tod: newTod,
      lead_time: newLeadTime,
      contact: newContact,
    }, brandId);
    setShowAddForm(false);
    setNewName('');
    setNewTod(DEFAULT_TOD);
    setNewLeadTime(0);
    setNewContact('');
    invalidate();
    toast.success('Προμηθευτής προστέθηκε');
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-[var(--nts-charcoal)]">Προμηθευτές</h2>
          <p className="text-sm text-[var(--nts-medium-gray)] mt-1">
            Διαχείριση προμηθευτών & Target Days of Stock (TOD) ανά προμηθευτή
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowAddForm(true)}
          >
            <Plus size={14} className="mr-1" />
            Προσθήκη
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={isImporting}
          >
            {isImporting ? <Spinner size="sm" /> : <Upload size={14} className="mr-1" />}
            Import CSV/Excel
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={handleImportFile}
            className="hidden"
          />
        </div>
      </div>

      {/* Info card about import format */}
      <Card className="p-4 bg-blue-50/50 border border-blue-100">
        <div className="flex items-start gap-3">
          <FileSpreadsheet size={20} className="text-blue-500 mt-0.5 shrink-0" />
          <div className="text-sm text-[var(--nts-charcoal)]">
            <p className="font-medium mb-1">Μορφή αρχείου εισαγωγής</p>
            <p className="text-[var(--nts-medium-gray)]">
              Στήλες: <code className="text-xs bg-white px-1 py-0.5 rounded">Supplier</code> (υποχρεωτικό), 
              <code className="text-xs bg-white px-1 py-0.5 rounded ml-1">TOD</code> (ημέρες, default {DEFAULT_TOD}), 
              <code className="text-xs bg-white px-1 py-0.5 rounded ml-1">Lead_Time</code> (ημέρες), 
              <code className="text-xs bg-white px-1 py-0.5 rounded ml-1">Contact</code>
            </p>
            <p className="text-[var(--nts-medium-gray)] mt-1">
              Τα προϊόντα συνδέονται με προμηθευτή μέσω της στήλης <code className="text-xs bg-white px-1 py-0.5 rounded">Supplier</code> στο product import.
            </p>
          </div>
        </div>
      </Card>

      {/* Add form */}
      <AnimatePresence>
        {showAddForm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            <Card className="p-4">
              <h3 className="text-sm font-semibold text-[var(--nts-charcoal)] mb-3">Νέος Προμηθευτής</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div>
                  <label className="text-xs text-[var(--nts-medium-gray)] mb-1 block">Όνομα *</label>
                  <input
                    type="text"
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    placeholder="π.χ. ACME Corp"
                    className="w-full text-sm border border-[#E5E5E5] rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--nts-accent)]/30"
                  />
                </div>
                <div>
                  <label className="text-xs text-[var(--nts-medium-gray)] mb-1 block">TOD (ημέρες)</label>
                  <input
                    type="number"
                    value={newTod}
                    onChange={e => setNewTod(parseInt(e.target.value) || DEFAULT_TOD)}
                    min={1}
                    className="w-full text-sm border border-[#E5E5E5] rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--nts-accent)]/30"
                  />
                </div>
                <div>
                  <label className="text-xs text-[var(--nts-medium-gray)] mb-1 block">Lead Time (ημέρες)</label>
                  <input
                    type="number"
                    value={newLeadTime}
                    onChange={e => setNewLeadTime(parseInt(e.target.value) || 0)}
                    min={0}
                    className="w-full text-sm border border-[#E5E5E5] rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--nts-accent)]/30"
                  />
                </div>
                <div>
                  <label className="text-xs text-[var(--nts-medium-gray)] mb-1 block">Επικοινωνία</label>
                  <input
                    type="text"
                    value={newContact}
                    onChange={e => setNewContact(e.target.value)}
                    placeholder="Email / Τηλ."
                    className="w-full text-sm border border-[#E5E5E5] rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--nts-accent)]/30"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-3">
                <Button variant="secondary" size="sm" onClick={() => setShowAddForm(false)}>Ακύρωση</Button>
                <Button variant="primary" size="sm" onClick={handleAddSupplier} disabled={!newName.trim()}>
                  <Check size={14} className="mr-1" /> Αποθήκευση
                </Button>
              </div>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-4 text-center">
          <Truck size={20} className="mx-auto text-[var(--nts-accent)] mb-1" />
          <p className="text-2xl font-bold text-[var(--nts-charcoal)]">{suppliers.length}</p>
          <p className="text-xs text-[var(--nts-medium-gray)]">Προμηθευτές</p>
        </Card>
        <Card className="p-4 text-center">
          <Clock size={20} className="mx-auto text-blue-500 mb-1" />
          <p className="text-2xl font-bold text-[var(--nts-charcoal)]">
            {suppliers.length > 0 ? Math.round(suppliers.reduce((s, x) => s + x.tod, 0) / suppliers.length) : DEFAULT_TOD}
          </p>
          <p className="text-xs text-[var(--nts-medium-gray)]">Μέσο TOD (ημέρες)</p>
        </Card>
        <Card className="p-4 text-center">
          <p className="text-2xl font-bold text-[var(--nts-charcoal)]">
            {suppliers.length > 0
              ? Math.round(suppliers.filter(s => (s.lead_time || 0) > 0).reduce((s, x) => s + (x.lead_time || 0), 0) / Math.max(suppliers.filter(s => (s.lead_time || 0) > 0).length, 1))
              : 0}
          </p>
          <p className="text-xs text-[var(--nts-medium-gray)]">Μέσο Lead Time (ημέρες)</p>
        </Card>
        <Card className="p-4 text-center">
          <p className="text-2xl font-bold text-[var(--nts-charcoal)]">
            {Array.from(productCountBySupplier.values()).reduce((a, b) => a + b, 0)}
          </p>
          <p className="text-xs text-[var(--nts-medium-gray)]">Συνδεδεμένα Προϊόντα</p>
        </Card>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--nts-medium-gray)]" />
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Αναζήτηση προμηθευτή..."
          className="w-full pl-9 pr-4 py-2 text-sm border border-[#E5E5E5] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--nts-accent)]/30"
        />
      </div>

      {/* Suppliers Table */}
      <Card className="overflow-hidden">
        {filteredSuppliers.length === 0 ? (
          <div className="p-12 text-center text-[var(--nts-medium-gray)]">
            <Truck size={48} className="mx-auto mb-4 opacity-20" />
            <p className="text-lg font-medium mb-1">Δεν υπάρχουν προμηθευτές</p>
            <p className="text-sm">Κάντε import CSV/Excel ή προσθέστε χειροκίνητα.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#F9F9F9] border-b border-[#E5E5E5]">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--nts-medium-gray)] uppercase tracking-wider">Προμηθευτής</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-[var(--nts-medium-gray)] uppercase tracking-wider">TOD (ημέρες)</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-[var(--nts-medium-gray)] uppercase tracking-wider">Lead Time</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-[var(--nts-medium-gray)] uppercase tracking-wider">Προϊόντα</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--nts-medium-gray)] uppercase tracking-wider">Επικοινωνία</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-[var(--nts-medium-gray)] uppercase tracking-wider">Ενέργειες</th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence>
                  {filteredSuppliers.map((s, i) => (
                    <motion.tr
                      key={s.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ delay: i * 0.02 }}
                      className="border-b border-[#E5E5E5] hover:bg-[#F5F5F5] transition-colors"
                    >
                      <td className="px-4 py-3 font-medium text-[var(--nts-charcoal)]">{s.name}</td>
                      <td className="px-4 py-3 text-center">
                        {editingId === s.id ? (
                          <input
                            type="number"
                            value={editTod}
                            onChange={e => setEditTod(parseInt(e.target.value) || DEFAULT_TOD)}
                            min={1}
                            className="w-20 text-center text-sm border border-[var(--nts-accent)] rounded px-2 py-1 focus:outline-none"
                            autoFocus
                          />
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-[var(--nts-accent)]/10 text-[var(--nts-accent)]">
                            {s.tod}d
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {editingId === s.id ? (
                          <input
                            type="number"
                            value={editLeadTime}
                            onChange={e => setEditLeadTime(parseInt(e.target.value) || 0)}
                            min={0}
                            className="w-20 text-center text-sm border border-[#E5E5E5] rounded px-2 py-1 focus:outline-none"
                          />
                        ) : (
                          <span className="text-sm text-[var(--nts-medium-gray)]">
                            {s.lead_time ? `${s.lead_time}d` : '—'}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="text-sm font-mono text-[var(--nts-charcoal)]">
                          {productCountBySupplier.get(s.name) || 0}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-[var(--nts-medium-gray)]">{s.contact || '—'}</td>
                      <td className="px-4 py-3 text-right">
                        {editingId === s.id ? (
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={handleSaveEdit} className="p-1 text-green-600 hover:bg-green-50 rounded">
                              <Check size={16} />
                            </button>
                            <button onClick={() => setEditingId(null)} className="p-1 text-[var(--nts-medium-gray)] hover:bg-gray-50 rounded">
                              <X size={16} />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => handleStartEdit(s)} className="p-1 text-[var(--nts-medium-gray)] hover:text-[var(--nts-accent)] hover:bg-gray-50 rounded" title="Επεξεργασία TOD">
                              <Pencil size={14} />
                            </button>
                            <button onClick={() => handleDelete(s.id)} className="p-1 text-[var(--nts-medium-gray)] hover:text-red-500 hover:bg-red-50 rounded" title="Διαγραφή">
                              <Trash2 size={14} />
                            </button>
                          </div>
                        )}
                      </td>
                    </motion.tr>
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Default TOD info */}
      <Card className="p-4 bg-gray-50/50">
        <p className="text-xs text-[var(--nts-medium-gray)]">
          <strong>Default TOD:</strong> Προϊόντα χωρίς αντιστοιχισμένο προμηθευτή χρησιμοποιούν TOD = {DEFAULT_TOD} ημέρες.
          Η κατηγοριοποίηση stock health (Healthy / Excess / Low / Dead) βασίζεται στο TOD κάθε προμηθευτή.
        </p>
      </Card>
    </div>
  );
}
