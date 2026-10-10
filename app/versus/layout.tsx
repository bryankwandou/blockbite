import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'BlockBite: Versus',
  description: "Play BlockBite head to head against a friend.",
  alternates: { canonical: '/versus' },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
