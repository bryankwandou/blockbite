import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'BlockBite: How to play',
  description: "Rules, scoring and how the daily USDC prize works.",
  alternates: { canonical: '/how-to-play' },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
