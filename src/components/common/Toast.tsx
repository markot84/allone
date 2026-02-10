import { createContext, useCallback, useContext, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, XCircle, X } from 'lucide-react';

type ToastVariant = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let id = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const remove = useCallback((toastId: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== toastId));
  }, []);

  const add = useCallback((message: string, variant: ToastVariant) => {
    const toastId = ++id;
    setToasts((prev) => [...prev, { id: toastId, message, variant }]);
    setTimeout(() => remove(toastId), 4500);
  }, [remove]);

  const success = useCallback((msg: string) => add(msg, 'success'), [add]);
  const error = useCallback((msg: string) => add(msg, 'error'), [add]);
  const info = useCallback((msg: string) => add(msg, 'info'), [add]);

  return (
    <ToastContext.Provider value={{ success, error, info }}>
      {children}
      <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 max-w-md pointer-events-none">
        <div className="pointer-events-auto flex flex-col gap-2">
          <AnimatePresence>
            {toasts.map((toast) => (
              <ToastItem key={toast.id} toast={toast} onClose={() => remove(toast.id)} />
            ))}
          </AnimatePresence>
        </div>
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onClose }: { toast: ToastItem; onClose: () => void }) {
  const styles = {
    success: 'bg-[#dafbe1] border-[#1a7f37]/30 text-[#1a7f37]',
    error: 'bg-[#ffebe9] border-[#cf222e]/30 text-[#cf222e]',
    info: 'bg-[#ddf4ff] border-[#0969da]/30 text-[#0969da]',
  };
  const icons = {
    success: <CheckCircle2 size={20} className="flex-shrink-0" />,
    error: <XCircle size={20} className="flex-shrink-0" />,
    info: null,
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 80 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 80 }}
      transition={{ type: 'tween', duration: 0.2 }}
      className={`flex items-start gap-3 px-4 py-3 rounded-xl border shadow-lg ${styles[toast.variant]}`}
    >
      {icons[toast.variant]}
      <p className="flex-1 text-sm font-medium leading-snug min-w-0">{toast.message}</p>
      <button
        type="button"
        onClick={onClose}
        className="p-1 rounded hover:bg-black/10 flex-shrink-0"
        aria-label="Κλείσιμο"
      >
        <X size={16} />
      </button>
    </motion.div>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
