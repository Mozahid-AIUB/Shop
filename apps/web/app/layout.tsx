import type { Metadata } from 'next';
import { Hind_Siliguri } from 'next/font/google';
import './globals.css';

// next/font ফন্ট self-host করে — external request নেই, layout shift নেই
const hindSiliguri = Hind_Siliguri({
  subsets: ['bengali', 'latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-hind-siliguri',
});

export const metadata: Metadata = {
  title: 'Shop',
  description: 'অনলাইন দোকান — পছন্দের পণ্য অর্ডার করো, পেমেন্ট করো, ডেলিভারি পর্যন্ত ট্র্যাক করো',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="bn" className={hindSiliguri.variable}>
      <body className="min-h-dvh bg-neutral-950 text-neutral-100 antialiased">{children}</body>
    </html>
  );
}
