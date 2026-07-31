import { Button } from './ui/Button';

export function PaginationBar({
  offset,
  pageSize,
  total,
  loading,
  onPrev,
  onNext,
}: {
  offset: number;
  pageSize: number;
  total: number;
  loading?: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  if (total === 0) return null;
  const start = offset + 1;
  const end = Math.min(offset + pageSize, total);
  return (
    <div className="pagination">
      <p className="muted">
        Showing {start}–{end} of {total}
      </p>
      <div className="row">
        <Button
          variant="secondary"
          size="sm"
          disabled={offset === 0 || loading}
          onClick={onPrev}
        >
          Previous
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={offset + pageSize >= total || loading}
          onClick={onNext}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
