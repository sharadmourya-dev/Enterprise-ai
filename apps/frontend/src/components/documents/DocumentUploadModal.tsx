'use client';

import React, { useState, useRef, useCallback } from 'react';
import {
  UploadCloud,
  FileText,
  X,
  AlertCircle,
  Shield,
  Lock,
  Building,
  Users,
  Info,
} from 'lucide-react';
import {
  Role,
  ClearanceLevel,
  CLEARANCE_RANK,
  DocumentMimeType,
  IDocumentUploadResponse,
} from '@enterprise-ai/shared-types';
import { useAuth } from '@/context/AuthContext';
import { ApiClient } from '@/lib/api-client';
import { Modal, Button, Input, useToast } from '@/components/ui';
import { cn } from '@/lib/utils';

export interface DocumentUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (uploadedDoc: IDocumentUploadResponse) => void;
}

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB
const ALLOWED_EXTENSIONS = ['.pdf', '.docx', '.txt'];
const ALLOWED_MIME_TYPES = [
  DocumentMimeType.PDF,
  DocumentMimeType.DOCX,
  DocumentMimeType.TXT,
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
];

export function DocumentUploadModal({
  isOpen,
  onClose,
  onSuccess,
}: DocumentUploadModalProps) {
  const { user, role, clearance, isAdmin } = useAuth();
  const { success, error: showErrorToast } = useToast();

  const [file, setFile] = useState<File | null>(null);
  const [customTitle, setCustomTitle] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  // Access Control Configuration
  const [minimumClearance, setMinimumClearance] = useState<ClearanceLevel>(
    clearance || ClearanceLevel.INTERNAL
  );
  const [selectedRoles, setSelectedRoles] = useState<Role[]>([]);
  const [departmentInput, setDepartmentInput] = useState<string>('');
  const [userIdsInput, setUserIdsInput] = useState<string>('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Derive allowed clearance choices based on active user's permissions
  const userClearanceRank = clearance ? CLEARANCE_RANK[clearance] ?? 1 : 1;
  const availableClearances = Object.values(ClearanceLevel).filter((level) => {
    if (isAdmin) return true;
    return (CLEARANCE_RANK[level] ?? 0) <= userClearanceRank;
  });

  const resetForm = useCallback(() => {
    setFile(null);
    setCustomTitle('');
    setValidationError(null);
    setIsUploading(false);
    setMinimumClearance(clearance || ClearanceLevel.INTERNAL);
    setSelectedRoles([]);
    setDepartmentInput('');
    setUserIdsInput('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [clearance]);

  const handleModalClose = () => {
    if (isUploading) return;
    resetForm();
    onClose();
  };

  const validateAndSetFile = (candidate: File | null) => {
    setValidationError(null);
    if (!candidate) {
      setFile(null);
      return;
    }

    if (candidate.size === 0) {
      setValidationError('Uploaded file is empty (0 bytes).');
      return;
    }

    if (candidate.size > MAX_FILE_SIZE_BYTES) {
      setValidationError(
        `File size (${(candidate.size / (1024 * 1024)).toFixed(2)} MB) exceeds the 50 MB limit.`
      );
      return;
    }

    const ext = '.' + candidate.name.split('.').pop()?.toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      setValidationError(
        `Unsupported file type '${ext}'. Allowed formats: .pdf, .docx, .txt`
      );
      return;
    }

    setFile(candidate);
    if (!customTitle) {
      // Pre-fill title without extension
      const baseName = candidate.name.replace(/\.[^/.]+$/, '');
      setCustomTitle(baseName);
    }
  };

  // Drag and drop event handlers
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      validateAndSetFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      validateAndSetFile(e.target.files[0]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || isUploading) return;

    setIsUploading(true);
    setValidationError(null);

    const formData = new FormData();
    formData.append('file', file);

    if (customTitle.trim()) {
      formData.append('title', customTitle.trim());
    }

    formData.append('minimumClearance', minimumClearance);

    // Append roles
    if (selectedRoles.length > 0) {
      selectedRoles.forEach((r) => formData.append('allowedRoles', r));
    }

    // Append department
    if (isAdmin) {
      if (departmentInput.trim()) {
        const depts = departmentInput
          .split(',')
          .map((d) => d.trim())
          .filter(Boolean);
        depts.forEach((d) => formData.append('allowedDepartments', d));
      }
    } else {
      // Non-admins automatically bound to their authenticated department
      if (user?.department) {
        formData.append('allowedDepartments', user.department);
      }
    }

    // Append user IDs (admins only)
    if (isAdmin && userIdsInput.trim()) {
      const uids = userIdsInput
        .split(',')
        .map((u) => u.trim())
        .filter(Boolean);
      uids.forEach((u) => formData.append('allowedUserIds', u));
    }

    try {
      const result = await ApiClient.upload<IDocumentUploadResponse>(
        '/api/v1/documents/upload',
        formData
      );

      success(
        `"${result.title}" uploaded and queued for vector ingestion.`,
        'Upload Accepted'
      );
      onSuccess(result);
      resetForm();
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Document upload failed';
      setValidationError(msg);
      showErrorToast(msg, 'Upload Error');
    } finally {
      setIsUploading(false);
    }
  };

  const toggleRole = (r: Role) => {
    if (!isAdmin && r !== role) return; // Non-admin cannot assign foreign roles
    setSelectedRoles((prev) =>
      prev.includes(r) ? prev.filter((item) => item !== r) : [...prev, r]
    );
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleModalClose}
      preventClose={isUploading}
      title="Upload Knowledge Document"
      description="Upload corporate documentation to the secure RAG vector repository."
      size="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Drag and Drop Zone */}
        <div>
          <label className="text-xs font-semibold uppercase tracking-wider text-muted block mb-2">
            Document File (.pdf, .docx, .txt &bull; Max 50 MB)
          </label>

          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,.txt"
            onChange={handleFileInputChange}
            className="hidden"
            id="document-file-upload"
          />

          {!file ? (
            <div
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                'border-2 border-dashed rounded-xl p-6 sm:p-8 text-center cursor-pointer transition-all duration-150',
                dragActive
                  ? 'border-brand-primary bg-brand-primary/5 scale-[1.01]'
                  : 'border-subtle hover:border-brand-primary/50 hover:bg-surface-elevated/50 bg-surface'
              )}
            >
              <div className="w-12 h-12 rounded-xl bg-brand-primary/10 text-brand-primary flex items-center justify-center mx-auto mb-3 shadow-xs">
                <UploadCloud className="w-6 h-6" />
              </div>
              <p className="text-sm font-semibold text-primary">
                Drag and drop your file here, or{' '}
                <span className="text-brand-primary underline underline-offset-2">browse</span>
              </p>
              <p className="text-xs text-muted mt-1">
                Supports Adobe PDF, Microsoft Word (.docx), and Plain Text (.txt) up to 50 MB
              </p>
            </div>
          ) : (
            <div className="flex items-center justify-between p-3.5 rounded-xl border border-subtle bg-surface-elevated/70">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-lg bg-brand-primary/10 text-brand-primary flex items-center justify-center shrink-0">
                  <FileText className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-primary truncate">{file.name}</p>
                  <p className="text-[11px] text-muted">
                    {(file.size / (1024 * 1024)).toFixed(2)} MB &bull; {file.type || 'Plain text'}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setFile(null);
                  if (fileInputRef.current) fileInputRef.current.value = '';
                }}
                disabled={isUploading}
                aria-label="Remove selected file"
                className="p-1.5 rounded-lg text-muted hover:text-status-error hover:bg-surface transition-colors min-h-[36px] min-w-[36px] flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* Custom Document Title */}
        <Input
          label="Document Title"
          placeholder="e.g. Employee Security Handbook 2026"
          value={customTitle}
          onChange={(e) => setCustomTitle(e.target.value)}
          disabled={isUploading}
          helperText="Display name within the RAG citation drawer and search indexes."
        />

        {/* Access Control & Permissions Section */}
        <div className="p-4 rounded-xl border border-subtle bg-surface-elevated/40 space-y-4">
          <div className="flex items-center gap-2 text-xs font-bold text-primary border-b border-subtle pb-2">
            <Shield className="w-4 h-4 text-brand-primary" />
            <span>Access Control &amp; Document Clearance</span>
          </div>

          {/* Minimum Clearance Level */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-secondary flex items-center justify-between">
              <span>Minimum Required Clearance</span>
              <span className="text-[11px] text-muted font-normal">
                Your Clearance: <strong className="text-primary">{clearance || 'INTERNAL'}</strong>
              </span>
            </label>
            <select
              value={minimumClearance}
              onChange={(e) => setMinimumClearance(e.target.value as ClearanceLevel)}
              disabled={isUploading}
              aria-label="Minimum Security Clearance"
              className="w-full px-3 py-2 rounded-lg border border-subtle bg-surface text-xs text-primary outline-none focus:ring-2 focus:ring-brand-primary"
            >
              {availableClearances.map((lvl) => (
                <option key={lvl} value={lvl}>
                  {lvl} (Level {CLEARANCE_RANK[lvl] ?? 0})
                </option>
              ))}
            </select>
          </div>

          {/* Allowed Roles Multi-Select */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-secondary flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-muted" />
              <span>Role Restrictions (Leave empty for all authenticated roles)</span>
            </label>
            <div className="flex items-center gap-2 flex-wrap">
              {Object.values(Role).map((r) => {
                const isSelected = selectedRoles.includes(r);
                const isPermitted = isAdmin || r === role;
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => toggleRole(r)}
                    disabled={!isPermitted || isUploading}
                    className={cn(
                      'px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-all flex items-center gap-1.5 select-none',
                      isSelected
                        ? 'border-brand-primary bg-brand-primary text-white shadow-xs'
                        : 'border-subtle bg-surface text-secondary hover:bg-surface-elevated',
                      !isPermitted && 'opacity-40 cursor-not-allowed hover:bg-surface'
                    )}
                  >
                    <span>{r}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Department Scope */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-secondary flex items-center gap-1.5">
              <Building className="w-3.5 h-3.5 text-muted" />
              <span>Department Scope</span>
            </label>
            {isAdmin ? (
              <input
                type="text"
                placeholder="e.g. Engineering, Finance (comma-separated or empty for all)"
                value={departmentInput}
                onChange={(e) => setDepartmentInput(e.target.value)}
                disabled={isUploading}
                className="w-full px-3 py-2 rounded-lg border border-subtle bg-surface text-xs text-primary placeholder:text-muted outline-none focus:ring-2 focus:ring-brand-primary"
              />
            ) : (
              <div className="flex items-center justify-between p-2.5 rounded-lg border border-subtle bg-surface text-xs text-primary">
                <span className="font-semibold">{user?.department || 'Your Department'}</span>
                <span className="text-[11px] text-muted">(Automatically assigned to your department)</span>
              </div>
            )}
          </div>

          {/* User IDs Scope (Admins Only) */}
          {isAdmin ? (
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-secondary flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-muted" />
                <span>Specific User IDs (Admin Only &bull; Comma-separated)</span>
              </label>
              <input
                type="text"
                placeholder="e.g. 60f8a923..., 60f8a924..."
                value={userIdsInput}
                onChange={(e) => setUserIdsInput(e.target.value)}
                disabled={isUploading}
                className="w-full px-3 py-2 rounded-lg border border-subtle bg-surface text-xs text-primary placeholder:text-muted outline-none focus:ring-2 focus:ring-brand-primary"
              />
            </div>
          ) : (
            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-surface text-[11px] text-muted border border-subtle/60">
              <Info className="w-3.5 h-3.5 text-muted shrink-0" />
              <span>
                User-specific access locks are restricted to administrators. Standard documents inherit department and clearance access rules.
              </span>
            </div>
          )}

          <div className="p-2.5 rounded-lg bg-surface text-[11px] text-muted flex items-start gap-2 border border-subtle/60">
            <Info className="w-3.5 h-3.5 text-brand-primary shrink-0 mt-0.5" />
            <span>
              {isAdmin ? (
                <>
                  <strong>Empty ACL Semantics:</strong> Leaving roles and departments unselected makes this document accessible across all enterprise employees possessing the required clearance rank.
                </>
              ) : (
                <>
                  <strong>Access Policy:</strong> Your uploaded document is automatically scoped to the <strong>{user?.department || 'your'}</strong> department and accessible to colleagues possessing the selected clearance.
                </>
              )}
            </span>
          </div>
        </div>

        {/* Validation or API Error Banner */}
        {validationError && (
          <div className="p-3 rounded-lg border border-status-error/30 bg-status-error/10 text-xs text-status-error flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="leading-relaxed">{validationError}</span>
          </div>
        )}

        {/* Modal Actions */}
        <div className="sticky bottom-0 z-10 -mx-5 -mb-5 md:-mx-6 md:-mb-6 mt-6 p-4 px-5 md:px-6 bg-surface-elevated border-t border-subtle flex items-center justify-end gap-3 shadow-[0_-4px_12px_rgba(0,0,0,0.06)] dark:shadow-[0_-4px_16px_rgba(0,0,0,0.35)]">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleModalClose}
            disabled={isUploading}
          >
            Cancel
          </Button>

          <Button
            type="submit"
            variant="primary"
            size="sm"
            isLoading={isUploading}
            disabled={!file || isUploading}
            leftIcon={<UploadCloud className="w-4 h-4" />}
            id="upload-document-submit-btn"
          >
            {isUploading ? 'Uploading & Enqueuing...' : 'Upload Document'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
