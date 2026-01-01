import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "eBay価格シミュレータ",
  description: "eBayの販売価格と利益を試算するツール"
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
