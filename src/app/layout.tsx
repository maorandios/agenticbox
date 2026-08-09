import type { Metadata } from "next";
import { Providers } from "@/components/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "AgenticBox",
  description: "לקוח מייל אייג׳נטי לעבודה עסקית",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="he" dir="rtl" className="h-full">
      <body className="min-h-full overflow-hidden antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
