'use client';

import { useParams } from 'next/navigation';
import MapView from '../MapView';

export default function MapActPage() {
  const { act } = useParams<{ act: string }>();
  const n = parseInt(act ?? '1', 10);
  return <MapView act={Number.isFinite(n) ? n : 1} />;
}
