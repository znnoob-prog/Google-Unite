import React, { useState } from 'react';
import { AlertTriangle, ShieldAlert, X } from 'lucide-react';
import { PendingConfirmation } from '../types.ts';

interface Props {
  confirmation: PendingConfirmation | null;
  onClose: () => void;
}

export const ConfirmActionModal: React.FC<Props> = ({ confirmation, onClose }) => {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!confirmation) return null;

  const handleConfirm = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await confirmation.onConfirm();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Action failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
    >
      <div className="w-full max-w-md rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xl overflow-hidden">
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div
              className={`p-2 rounded-lg ${
                confirmation.isDestructive
                  ? 'bg-red-50 text-red-600 dark:bg-red-950/60 dark:text-red-400'
                  : 'bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400'
              }`}
            >
              {confirmation.isDestructive ? (
                <AlertTriangle className="w-5 h-5" />
              ) : (
                <ShieldAlert className="w-5 h-5" />
              )}
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                {confirmation.serviceLabel}
              </p>
              <h2
                id="confirm-modal-title"
                className="text-base font-semibold text-slate-900 dark:text-slate-100"
              >
                {confirmation.title}
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label="Close confirmation"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">
          <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
            {confirmation.description}
          </p>

          {confirmation.items && confirmation.items.length > 0 && (
            <ul className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 divide-y divide-slate-200 dark:divide-slate-800 text-xs text-slate-700 dark:text-slate-300 max-h-40 overflow-y-auto">
              {confirmation.items.map((item, idx) => (
                <li key={idx} className="px-3 py-2 truncate">
                  {item}
                </li>
              ))}
            </ul>
          )}

          {error && (
            <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 px-3 py-2 rounded-lg border border-red-200 dark:border-red-900">
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2.5 px-5 py-3.5 bg-slate-50 dark:bg-slate-950/50 border-t border-slate-200 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={submitting}
            className={`px-4 py-2 text-sm font-medium rounded-lg text-white transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 ${
              confirmation.isDestructive
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {submitting ? 'Processing...' : confirmation.confirmLabel || 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
};
