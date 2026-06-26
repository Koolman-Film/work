import MergeClient from './merge-client';

type Params = Promise<{ token: string }>;

export default async function LiffMergePage({ params }: { params: Params }) {
  const { token } = await params;
  return <MergeClient mergeToken={token} />;
}
