'use client';

import React, { useState } from 'react';
import { UploadCloud, Database, BookOpen } from 'lucide-react';
import { AppShell } from '@/components/layout';
import { DocumentList, DocumentUploadModal } from '@/components/documents';
import { Button } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';

export default function DocumentsPage() {
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const { isAdmin, canUpload } = useAuth();

  const handleUploadSuccess = () => {
    // Increment trigger to refresh list
    setRefreshTrigger((prev) => prev + 1);
  };

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Page Header matching approved UI board */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-subtle pb-5">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-brand-primary/10 text-brand-primary flex items-center justify-center shrink-0">
                {isAdmin ? (
                  <Database className="w-4 h-4" />
                ) : (
                  <BookOpen className="w-4 h-4" />
                )}
              </div>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-primary">
                {isAdmin ? 'Document Repository' : 'Knowledge Base'}
              </h1>
            </div>
            <p className="text-xs sm:text-sm text-secondary">
              {isAdmin
                ? "Manage your company's knowledge base. Upload, configure access, and monitor indexing."
                : 'Browse documents available to your department.'}
            </p>
          </div>

          {/* Upload Document Action (Admins and authorized employees with upload permission) */}
          {canUpload && (
            <div className="flex items-center gap-2">
              <Button
                variant="primary"
                size="md"
                onClick={() => setUploadModalOpen(true)}
                leftIcon={<UploadCloud className="w-4 h-4" />}
                className="font-semibold shadow-xs"
                id="open-upload-modal-btn"
              >
                Upload Document
              </Button>
            </div>
          )}
        </div>

        {/* Main Document Table & Filtering */}
        <DocumentList
          onUploadClick={() => setUploadModalOpen(true)}
          refreshTrigger={refreshTrigger}
          isReadOnly={!isAdmin}
          canUpload={canUpload}
        />

        {/* Document Upload Modal (Available to users possessing upload permission) */}
        {canUpload && (
          <DocumentUploadModal
            isOpen={uploadModalOpen}
            onClose={() => setUploadModalOpen(false)}
            onSuccess={handleUploadSuccess}
          />
        )}
      </div>
    </AppShell>
  );
}
