import type { PaginationMeta } from '@linkiq/types';
import { Button } from '@linkiq/ui';

interface PaginationFooterProps {
  pagination: PaginationMeta;
  onPageChange: (page: number) => void;
}

/** The exact Prev/Next + "Page X of Y · N items" footer the existing
 * dashboard list pages already use (see dashboard/links/page.tsx) —
 * reused verbatim for every admin list so pagination behaves and reads
 * identically across the whole app. */
export function PaginationFooter({ pagination, onPageChange }: PaginationFooterProps) {
  return (
    <div className="flex items-center justify-between px-1 py-3 text-sm text-muted-foreground">
      <span>
        Page {pagination.page} of {pagination.totalPages} · {pagination.totalItems} items
      </span>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={pagination.page <= 1}
          onClick={() => onPageChange(pagination.page - 1)}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={pagination.page >= pagination.totalPages}
          onClick={() => onPageChange(pagination.page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
