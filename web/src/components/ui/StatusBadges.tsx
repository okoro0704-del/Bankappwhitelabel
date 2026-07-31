import { Badge } from './Feedback';
import {
  statusLabel,
  statusTone,
  transactionTypeLabel,
  transactionTypeTone,
} from '../../utils/format';

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={statusTone(status)}>{statusLabel(status)}</Badge>;
}

export function TypeBadge({ type }: { type: string }) {
  return <Badge tone={transactionTypeTone(type)}>{transactionTypeLabel(type)}</Badge>;
}
