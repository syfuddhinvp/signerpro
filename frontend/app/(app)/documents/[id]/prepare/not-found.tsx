import DocumentMissing from '@/components/sf/parts/DocumentMissing';

export default function NotFound() {
  return (
    <DocumentMissing
      title="This document isn't available"
      body="It may have been deleted, or it belongs to another organization. Pick a document from the list to prepare it."
    />
  );
}
