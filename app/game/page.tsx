import Navbar from '@/components/Navbar';
import AdventureShell from '@/components/game/AdventureShell';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'BlockBite Adventure: free block puzzle',
  description: 'BlockBite Adventure is free: no tickets, no prizes. Place three pieces, clear rows and columns on the 8×8 board.',
};

export default function GamePage() {
  return (
    <>
      <Navbar />
      <AdventureShell />
    </>
  );
}
