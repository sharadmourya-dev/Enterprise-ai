'use client';

import React, { useState } from 'react';
import {
  FileText,
  UploadCloud,
  CheckCircle2,
  Clock,
  AlertCircle,
  Database,
  Layers,
} from 'lucide-react';
import { AppShell } from '@/components/layout';
import {
  DocumentList,
  DocumentUploadModal,
} from '@/components/documents';
import { Card, Button, Badge } from '@/components/ui';

export default function DocumentsPage() {
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const handleUploadSuccess = () => {
    // Increment trigger to refresh list
    setRefreshTrigger((prev) => prev + 1);
  };

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-subtle pb-5">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-brand-primary/10 text-brand-primary flex items-center justify-center shrink-0">
                <Database className="w-4 h-4" />
              </div>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-primary">
                Knowledge Document Repository
              </h1>
            </div>
            <p className="text-xs sm:text-sm text-secondary">
              Upload, configure security clearances, and monitor vector indexing for multi-turn Copilot retrieval.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              size="md"
              onClick={() => setUploadModalOpen(true)}
              leftIcon={<UploadCloud className="w-4 h-4" />}
              className="font-semibold shadow-xs"
            >
              Upload Document
            </Button>
          </div>
        </div>

        {/* Informational Guidance Banner */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Card variant="default" className="p-3.5 bg-surface-elevated/40 flex items-start gap-3">
            <div className="w-7 h-7 rounded-lg bg-brand-primary/10 text-brand-primary flex items-center justify-center shrink-0 mt-0.5">
              <UploadCloud className="w-4 h-4" />
            </div>
            <div className="space-y-0.5">
              <p className="text-xs font-bold text-primary">Supported Formats</p>
              <p className="text-[11px] text-muted">
                PDF, Word (.docx), and Plain Text (.txt) up to 50 MB per file.
              </p>
            </div>
          </Card>

          <Card variant="default" className="p-3.5 bg-surface-elevated/40 flex items-start gap-3">
            <div className="w-7 h-7 rounded-lg bg-status-info/10 text-status-info flex items-center justify-center shrink-0 mt-0.5">
              <Layers className="w-4 h-4" />
            </div>
            <div className="space-y-0.5">
              <p className="text-xs font-bold text-primary">Pipeline Ingestion</p>
              <p className="text-[11px] text-muted">
                Automatic text extraction, semantic chunking, and Qdrant vector indexing.
              </p>
            </div>
          </Card>

          <Card variant="default" className="p-3.5 bg-surface-elevated/40 flex items-start gap-3">
            <div className="w-7 h-7 rounded-lg bg-status-success/10 text-status-success flex items-center justify-center shrink-0 mt-0.5">
              <CheckCircle2 className="w-4 h-4" />
            </div>
            <div className="space-y-0.5">
              <p className="text-xs font-bold text-primary">Granular Access Control</p>
              <p className="text-[11px] text-muted">
                Document clearance, department isolation, and role-based permissions enforced.
              </p>
            </div>
          </Card>
        </div>

        {/* Main Document Table & Filtering */}
        <DocumentList
          onUploadClick={() => setUploadModalOpen(true)}
          refreshTrigger={refreshTrigger}
        />

        {/* Document Upload Modal */}
        <DocumentUploadModal
          isOpen={uploadModalOpen}
          onClose={() => setUploadModalOpen(false)}
          onSuccess={handleUploadSuccess}
        />
      </div>
    </AppShell>
  );
}
