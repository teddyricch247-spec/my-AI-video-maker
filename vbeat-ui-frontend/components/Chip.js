import { STATUS } from '@/lib/data';
export default function Chip({ status }) {
  const [label, kind] = STATUS[status];
  return <span className={`chip ${kind}`}>{label}</span>;
}
