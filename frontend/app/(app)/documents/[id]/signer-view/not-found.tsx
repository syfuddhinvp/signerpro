import DocumentMissing from '@/components/sf/parts/DocumentMissing';

export default function NotFound() {
  return (
    <DocumentMissing
      title="This envelope isn't available"
      body="It may have been deleted, or it belongs to another organization. Pick a document from the list to preview what a recipient sees."
    />
  );
}
