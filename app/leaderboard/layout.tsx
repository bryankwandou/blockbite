import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'BlockBite: Daily leaderboard',
  description: "Today's top BlockBite scores and USDC prize ranks.",
  alternates: { canonical: '/leaderboard' },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
