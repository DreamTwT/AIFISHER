import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { dismissToast } from '../store/ui';
import { useUIState } from './hooks';

export function Toasts() {
  const ui = useUIState();
  if (!ui.toasts.length) return null;
  return (
    <div className="toasts">
      {ui.toasts.map((toast) => (
        <div key={toast.id} className={`toast ${toast.kind}`}>
          <span className="toast-icon">
            {toast.kind === 'success' ? (
              <CheckCircle2 size={14} />
            ) : toast.kind === 'error' ? (
              <AlertTriangle size={14} />
            ) : (
              <Info size={14} />
            )}
          </span>
          <span className="toast-msg">{toast.message}</span>
          {toast.actionLabel ? (
            <button
              className="toast-action"
              onClick={() => {
                toast.action?.();
                dismissToast(toast.id);
              }}
            >
              {toast.actionLabel}
            </button>
          ) : null}
          <button className="toast-close" onClick={() => dismissToast(toast.id)}>
            <X size={11} />
          </button>
        </div>
      ))}
    </div>
  );
}
