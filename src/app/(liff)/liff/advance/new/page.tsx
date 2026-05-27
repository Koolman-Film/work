import { requireRole } from '@/lib/auth/require-role';
import { AdvanceNewForm } from './advance-new-form';

export default async function NewAdvancePage() {
  await requireRole(['Employee']);
  return <AdvanceNewForm />;
}
