'use client';

import { useParams } from 'next/navigation';
import ExperimentWorkspace from '@/components/workspace/ExperimentWorkspace';

export default function ExperimentDetailPage() {
  const params = useParams();
  const id = params.id as string;

  return <ExperimentWorkspace experimentId={id} />;
}
