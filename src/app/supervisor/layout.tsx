import type { ReactNode } from 'react';
import { SupervisorShell } from '@/components/supervisor/SupervisorShell';

export default function SupervisorLayout({ children }: { children: ReactNode }) {
  return <SupervisorShell>{children}</SupervisorShell>;
}
