import DocumentMissing from '@/components/sf/parts/DocumentMissing';

export default function NotFound() {
  return (
    <DocumentMissing
      title="This audit trail isn't available"
      body="The envelope may have been deleted, or it belongs to another organization. Pick a document from the list to open its trail."
    />
  );
}
