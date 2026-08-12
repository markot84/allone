import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, FileSpreadsheet, FileText, FileCode, BarChart3, ExternalLink } from 'lucide-react';
import { Button, ModalHeader } from '../common';
import { downloadProductIntelligenceCsv, downloadProductIntelligenceXlsx } from '../../utils/productIntelligenceExport';
import { safeBrandName } from '../../services/reportExport';
import { logger } from '../../utils/logger';
import type { Product } from '../../types';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  filteredProducts: Product[];
  onShowCharts?: () => void;
  brandName?: string;
  scopeLabel?: string;
}

export function ExportModal({ isOpen, onClose, filteredProducts, onShowCharts, brandName, scopeLabel }: ExportModalProps) {
  const [showGoogleSheetsModal, setShowGoogleSheetsModal] = useState(false);
  
  if (!isOpen) return null;

  const brand = safeBrandName(brandName);
  const date = new Date().toISOString().split('T')[0];

  const exportToCSV = () => {
    downloadProductIntelligenceCsv(filteredProducts, brandName);
    onClose();
  };

  const exportToExcel = async () => {
    try {
      await downloadProductIntelligenceXlsx(filteredProducts, brandName);
      onClose();
    } catch (error) {
      logger.error('Excel export error:', { err: error });
      alert('Σφάλμα κατά την εξαγωγή Excel. Δοκιμάστε CSV.');
    }
  };

  const exportToGoogleAdsXml = () => {
    const cdata = (s: string) => String(s).replace(/]]>/g, ']]]]><![CDATA[>');
    const escape = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const entries = filteredProducts.map((p) => {
      const id = p.sku || p.id;
      const title = p.name || id;
      const price = `${(p.price ?? 0).toFixed(2)} EUR`;
      const availability = (p.stock_level ?? 0) > 0 ? 'in stock' : 'out of stock';
      const productType = p.category || '';
      const link = ((p as unknown) as Record<string, unknown>).product_url as string | undefined || '';
      const imageLink = ((p as unknown) as Record<string, unknown>).image_url as string | undefined || '';
      return [
        `  <entry>`,
        `    <g:item_group_id><![CDATA[${id}]]></g:item_group_id>`,
        `    <title><![CDATA[${cdata(title)}]]></title>`,
        `    <g:price>${price}</g:price>`,
        `    <g:sale_price>${price}</g:sale_price>`,
        `    <description><![CDATA[${cdata(title)}]]></description>`,
        `    <g:google_product_category/>`,
        `    <g:product_type><![CDATA[${cdata(productType)}]]></g:product_type>`,
        `    <g:availability>${availability}</g:availability>`,
        `    <g:brand/>`,
        imageLink ? `    <g:image_link><![CDATA[${imageLink}]]></g:image_link>` : `    <g:image_link/>`,
        link ? `    <link><![CDATA[${link}]]></link>` : `    <link/>`,
        `    <g:size/>`,
        `    <g:size_type/>`,
        `    <g:size_system>EU</g:size_system>`,
        `    <g:material/>`,
        `    <g:custom_label_0/>`,
        `    <g:identifier_exists>no</g:identifier_exists>`,
        `    <g:condition>new</g:condition>`,
        `    <g:gender/>`,
        `    <g:id>${escape(id)}</g:id>`,
        `  </entry>`,
      ].join('\n');
    });
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<feed xmlns:g="http://base.google.com/ns/1.0">',
      entries.join('\n'),
      '</feed>',
    ].join('\n');
    const blob = new Blob([xml], { type: 'application/xml;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${brand}_google_ads_feed_${date}.xml`;
    link.click();
    URL.revokeObjectURL(link.href);
    onClose();
  };

  const exportToGoogleSheets = () => {
    downloadProductIntelligenceCsv(filteredProducts, brandName);
    
    // Show modal to ask if user wants to open Google Sheets
    setTimeout(() => {
      setShowGoogleSheetsModal(true);
    }, 100);
  };

  const showCharts = () => {
    if (onShowCharts) {
      onShowCharts();
    }
    onClose();
  };

  return (
    <>
      <AnimatePresence>
        {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            className="bg-white rounded-2xl shadow-2xl max-w-md w-full"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="p-6 border-b border-[#E5E5E5] flex items-center justify-between">
              <h2 className="text-xl font-bold text-[#1A1A1A]">Επιλογές εξαγωγής</h2>
              <button
                onClick={onClose}
                className="p-2 hover:bg-[var(--surface-2)] rounded-lg transition-colors"
              >
                <X size={20} className="text-[var(--text-secondary)]" />
              </button>
            </div>

            {/* Content */}
            <div className="p-6 space-y-3">
              <p className="text-sm text-[var(--text-secondary)] mb-4">
                Εξαγωγή <strong>{scopeLabel ?? 'τρέχουσας φιλτραρισμένης προβολής'}</strong>: <strong>{filteredProducts.length}</strong> προϊόντα
              </p>

              <button
                onClick={exportToExcel}
                className="w-full p-4 border-2 border-[#E5E5E5] rounded-xl hover:border-[var(--nts-accent)] hover:bg-[var(--nts-light-gray)] transition-all text-left flex items-center gap-4 group"
              >
                <div className="p-3 bg-[#22C55E]/10 rounded-lg group-hover:bg-[#22C55E]/20 transition-colors">
                  <FileSpreadsheet size={24} className="text-[#22C55E]" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-[#1A1A1A]">Εξαγωγή σε Excel (.xlsx)</h3>
                  <p className="text-xs text-[var(--text-secondary)]">Λήψη αρχείου .xlsx</p>
                </div>
              </button>

              <button
                onClick={exportToCSV}
                className="w-full p-4 border-2 border-[#E5E5E5] rounded-xl hover:border-[var(--nts-accent)] hover:bg-[var(--nts-light-gray)] transition-all text-left flex items-center gap-4 group"
              >
                <div className="p-3 bg-[#F5F5F5] rounded-lg group-hover:bg-[var(--surface-2)] transition-colors">
                  <FileText size={24} className="text-[var(--text-secondary)]" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-[#1A1A1A]">Εξαγωγή σε CSV</h3>
                  <p className="text-xs text-[var(--text-secondary)]">Λήψη αρχείου .csv</p>
                </div>
              </button>

              <button
                onClick={exportToGoogleAdsXml}
                className="w-full p-4 border-2 border-[#E5E5E5] rounded-xl hover:border-[var(--nts-accent)] hover:bg-[var(--nts-light-gray)] transition-all text-left flex items-center gap-4 group"
              >
                <div className="p-3 bg-[#EA4335]/10 rounded-lg group-hover:bg-[#EA4335]/20 transition-colors">
                  <FileCode size={24} className="text-[#EA4335]" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-[#1A1A1A]">Εξαγωγή XML Google Ads</h3>
                  <p className="text-xs text-[var(--text-secondary)]">Product feed για Google Merchant Center</p>
                </div>
              </button>

              <button
                onClick={exportToGoogleSheets}
                className="w-full p-4 border-2 border-[#E5E5E5] rounded-xl hover:border-[var(--nts-accent)] hover:bg-[var(--nts-light-gray)] transition-all text-left flex items-center gap-4 group"
              >
                <div className="p-3 bg-[#34A853]/10 rounded-lg group-hover:bg-[#34A853]/20 transition-colors">
                  <ExternalLink size={24} className="text-[#34A853]" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-[#1A1A1A]">Άνοιγμα στο Google Sheets</h3>
                  <p className="text-xs text-[var(--text-secondary)]">Εισαγωγή δεδομένων σε νέο spreadsheet</p>
                </div>
              </button>

              <button
                onClick={showCharts}
                className="w-full p-4 border-2 border-[#E5E5E5] rounded-xl hover:border-[var(--nts-accent)] hover:bg-[var(--nts-light-gray)] transition-all text-left flex items-center gap-4 group"
              >
                <div className="p-3 bg-[#8B5CF6]/10 rounded-lg group-hover:bg-[#8B5CF6]/20 transition-colors">
                  <BarChart3 size={24} className="text-[#8B5CF6]" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-[#1A1A1A]">Προβολή διαγραμμάτων</h3>
                  <p className="text-xs text-[var(--text-secondary)]">Οπτικοποίηση δεδομένων με γραφήματα</p>
                </div>
              </button>
            </div>

            {/* Footer */}
            <div className="p-6 border-t border-[#E5E5E5] flex justify-end">
              <Button variant="ghost" onClick={onClose}>
                Ακύρωση
              </Button>
            </div>
          </motion.div>
        </motion.div>
        )}
      </AnimatePresence>

      {/* Google Sheets Confirmation Modal */}
      <AnimatePresence>
        {showGoogleSheetsModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4"
            onClick={() => {
              setShowGoogleSheetsModal(false);
              onClose();
            }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl shadow-2xl max-w-md w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <ModalHeader
                toolbarAriaLabel="Κλείσιμο"
                title="Η λήψη CSV ολοκληρώθηκε"
                actions={
                  <button
                    type="button"
                    onClick={() => {
                      setShowGoogleSheetsModal(false);
                      onClose();
                    }}
                    className="rounded-lg p-2 transition-colors hover:bg-[var(--surface-2)]"
                  >
                    <X size={20} className="text-[var(--text-secondary)]" />
                  </button>
                }
              />

              {/* Content */}
              <div className="p-6 space-y-4">
                <p className="text-sm text-[var(--text-secondary)]">
                  Το CSV αρχείο κατέβηκε επιτυχώς!
                </p>
                <div className="bg-[#F5F5F5] rounded-lg p-4 space-y-2">
                  <p className="text-sm font-semibold text-[#1A1A1A]">Για να το εισάγεις στο Google Sheets:</p>
                  <ol className="text-sm text-[var(--text-secondary)] space-y-1 list-decimal list-inside">
                    <li>Κάνε "File" → "Import"</li>
                    <li>Επέλεξε "Upload" και ανέβασε το αρχείο</li>
                    <li>Επέλεξε "Replace spreadsheet" ή "Insert new sheet(s)"</li>
                  </ol>
                </div>
                <p className="text-sm text-[var(--text-secondary)]">
                  Θέλεις να ανοίξεις το Google Sheets τώρα;
                </p>
              </div>

              {/* Footer */}
              <div className="p-6 border-t border-[#E5E5E5] flex justify-end gap-3">
                <Button 
                  variant="ghost" 
                  onClick={() => {
                    setShowGoogleSheetsModal(false);
                    onClose();
                  }}
                >
                  Ακύρωση
                </Button>
                <Button 
                  variant="primary" 
                  icon={<ExternalLink size={16} />}
                  onClick={() => {
                    window.open('https://sheets.google.com', '_blank');
                    setShowGoogleSheetsModal(false);
                    onClose();
                  }}
                >
                  Άνοιγμα Google Sheets
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
