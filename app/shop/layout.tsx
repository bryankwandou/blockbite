import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'BlockBite: Shop',
  description: "Ranked tickets and cosmetics for BlockBite.",
  alternates: { canonical: '/shop' },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
