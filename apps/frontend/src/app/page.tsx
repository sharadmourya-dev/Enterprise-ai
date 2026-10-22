'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  ShieldCheck,
  Search,
  Sparkles,
  Send,
  Layers,
  CheckCircle2,
  Lock,
  ArrowRight,
  MessageSquare,
  FileText,
  BarChart3,
  History,
} from 'lucide-react';
import {
  Button,
  Input,
  Textarea,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  Badge,
  Modal,
  ModalFooter,
  Skeleton,
  useToast,
} from '@/components/ui';
import { AppShell } from '@/components/layout/AppShell';
import { useAuth } from '@/context/AuthContext';
import { Role, ClearanceLevel } from '@enterprise-ai/shared-types';

export default function OverviewPage() {
  const { success, error, info, warning } = useToast();
  const { user, isAdmin, role, clearance } = useAuth();
  const [modalOpen, setModalOpen] = useState(false);
  const [inputVal, setInputVal] = useState('');
  const [textareaVal, setTextareaVal] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const toggleLoading = () => {
    setIsLoading(true);
    setTimeout(() => {
      setIsLoading(false);
      success('Operation completed successfully', 'Verification Passed');
    }, 1000);
  };

  return (
    <AppShell>
      <div className="space-y-8">
        {/* Welcome / Dashboard header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-subtle">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-primary">
              Enterprise Knowledge Portal
            </h1>
            <p className="text-sm text-secondary mt-1">
              Welcome back, <span className="font-semibold text-primary">{user?.name}</span>. Access your authorized AI Copilot and corporate documents.
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <Badge variant="brand" icon={<Sparkles className="w-3 h-3" />}>
              Enterprise Copilot &bull; Active
            </Badge>
          </div>
        </div>

        {/* Quick Navigation Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Link href="/chat" className="group">
            <Card variant="interactive" className="h-full">
              <CardHeader className="pb-2">
                <div className="w-10 h-10 rounded-lg bg-brand-primary/10 text-brand-primary flex items-center justify-center mb-1 group-hover:scale-105 transition-transform">
                  <MessageSquare className="w-5 h-5" />
                </div>
                <CardTitle className="text-base">Copilot Chat</CardTitle>
                <CardDescription className="text-xs">
                  Ask questions with grounded citations
                </CardDescription>
              </CardHeader>
              <CardFooter className="pt-2 text-xs font-semibold text-brand-primary flex items-center gap-1">
                Launch Copilot <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
              </CardFooter>
            </Card>
          </Link>

          <Link href="/documents" className="group">
            <Card variant="interactive" className="h-full">
              <CardHeader className="pb-2">
                <div className="w-10 h-10 rounded-lg bg-status-info/10 text-status-info flex items-center justify-center mb-1 group-hover:scale-105 transition-transform">
                  <FileText className="w-5 h-5" />
                </div>
                <CardTitle className="text-base">Documents</CardTitle>
                <CardDescription className="text-xs">
                  Upload &amp; manage indexed knowledge
                </CardDescription>
              </CardHeader>
              <CardFooter className="pt-2 text-xs font-semibold text-status-info flex items-center gap-1">
                View Repository <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
              </CardFooter>
            </Card>
          </Link>

          {isAdmin ? (
            <>
              <Link href="/admin/analytics" className="group">
                <Card variant="interactive" className="h-full border-brand-primary/20">
                  <CardHeader className="pb-2">
                    <div className="w-10 h-10 rounded-lg bg-status-success/10 text-status-success flex items-center justify-center mb-1 group-hover:scale-105 transition-transform">
                      <BarChart3 className="w-5 h-5" />
                    </div>
                    <CardTitle className="text-base">Admin Analytics</CardTitle>
                    <CardDescription className="text-xs">
                      Monitor usage, latency &amp; cache
                    </CardDescription>
                  </CardHeader>
                  <CardFooter className="pt-2 text-xs font-semibold text-status-success flex items-center gap-1">
                    Open Telemetry <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
                  </CardFooter>
                </Card>
              </Link>

              <Link href="/admin/audit" className="group">
                <Card variant="interactive" className="h-full border-brand-primary/20">
                  <CardHeader className="pb-2">
                    <div className="w-10 h-10 rounded-lg bg-status-warning/10 text-status-warning flex items-center justify-center mb-1 group-hover:scale-105 transition-transform">
                      <History className="w-5 h-5" />
                    </div>
                    <CardTitle className="text-base">Audit Inspector</CardTitle>
                    <CardDescription className="text-xs">
                      Verify cryptographic HMAC chain
                    </CardDescription>
                  </CardHeader>
                  <CardFooter className="pt-2 text-xs font-semibold text-status-warning flex items-center gap-1">
                    Inspect Logs <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
                  </CardFooter>
                </Card>
              </Link>
            </>
          ) : (
            <Card variant="elevated" className="h-full col-span-1 sm:col-span-2">
              <CardHeader className="pb-2">
                <div className="w-10 h-10 rounded-lg bg-surface-elevated text-muted flex items-center justify-center mb-1">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <CardTitle className="text-base">Security Clearance Active</CardTitle>
                <CardDescription className="text-xs">
                  Your requests are automatically filtered to resources matching clearance rank &lsquo;{clearance}&rsquo;.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-1 text-xs text-secondary">
                Department: <span className="font-semibold text-primary">{user?.department}</span> &bull; Role: <span className="font-semibold text-primary">{role}</span>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Design System & Token Telemetry Card */}
        <Card variant="elevated">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Session &amp; Token Telemetry</CardTitle>
              <Badge variant="success">Authenticated</Badge>
            </div>
            <CardDescription>
              Authenticated application shell active with responsive desktop sidebar and mobile drawer.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="p-3 rounded-lg border border-subtle bg-surface">
                <span className="text-muted block">Profile Email</span>
                <span className="font-semibold text-primary truncate block">{user?.email}</span>
              </div>
              <div className="p-3 rounded-lg border border-subtle bg-surface">
                <span className="text-muted block">Security Clearance</span>
                <span className="font-semibold text-brand-primary">{clearance}</span>
              </div>
              <div className="p-3 rounded-lg border border-subtle bg-surface">
                <span className="text-muted block">Role Status</span>
                <span className="font-semibold text-status-success">{role}</span>
              </div>
              <div className="p-3 rounded-lg border border-subtle bg-surface">
                <span className="text-muted block">Admin Privilege</span>
                <span className="font-semibold text-status-info">{isAdmin ? 'Granted' : 'Standard'}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Interactive Components Demo */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Quick Search &amp; Form Controls</CardTitle>
              <CardDescription>Accessible inputs with visual focus states</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Input
                label="Search Knowledge Base"
                placeholder="Type query to test input state..."
                value={inputVal}
                onChange={(e) => setInputVal(e.target.value)}
                leftIcon={<Search className="w-4 h-4" />}
                helperText="Search knowledge base documents or ask Copilot directly via Chat"
              />

              <div className="flex gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  isLoading={isLoading}
                  onClick={toggleLoading}
                >
                  Test Async Trigger
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setModalOpen(true)}
                >
                  Open Dialog
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>System Notifications</CardTitle>
              <CardDescription>Transient status feedback with 4000ms auto-dismiss</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-2.5">
              <Button variant="outline" size="sm" onClick={() => success('Document indexed successfully', 'Success')}>
                Success Toast
              </Button>
              <Button variant="outline" size="sm" onClick={() => error('Authorization denied for chunk #4', 'Error')}>
                Error Toast
              </Button>
              <Button variant="outline" size="sm" onClick={() => warning('Clearance required: RESTRICTED', 'Warning')}>
                Warning Toast
              </Button>
              <Button variant="outline" size="sm" onClick={() => info('Cache hit: 12ms via Redis', 'Telemetry')}>
                Info Toast
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Test Dialog */}
        <Modal
          isOpen={modalOpen}
          onClose={() => setModalOpen(false)}
          title="Security Clearance Rules"
          description="Access to sensitive information is governed by cryptographic principal tokens."
        >
          <div className="space-y-3 py-2 text-xs">
            <p className="text-secondary">
              Clearance ranks are evaluated dynamically per retrieval candidate. Documents classified as CONFIDENTIAL or RESTRICTED cannot be accessed by unclassified agents.
            </p>
          </div>
          <ModalFooter>
            <Button variant="primary" onClick={() => setModalOpen(false)}>
              Acknowledge
            </Button>
          </ModalFooter>
        </Modal>
      </div>
    </AppShell>
  );
}
