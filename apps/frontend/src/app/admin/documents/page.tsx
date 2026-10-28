'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Legacy /admin/documents route.
 * Redirects permanently to the unified canonical repository route `/documents`.
 */
export default function AdminDocumentsRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/documents');
  }, [router]);

  return null;
}
