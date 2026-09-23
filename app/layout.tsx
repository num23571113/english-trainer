import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "English Trainer",
  description:
    "AI English vocabulary, interview, reading and speaking trainer",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}