import type { Metadata } from "next";
import { ThemeProvider } from "next-themes";
import "./globals.css";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";
let apiOrigin = "";
if (API_URL) {
  try {
    apiOrigin = new URL(API_URL).origin;
  } catch {
    apiOrigin = "";
  }
}

export const metadata: Metadata = {
  title: "TraceOS Lab",
  description: "AI",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      {apiOrigin ? (
        <>
          <link rel="preconnect" href={apiOrigin} crossOrigin="anonymous" />
          <link rel="dns-prefetch" href={apiOrigin} />
        </>
      ) : null}
      <body className="antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange={false}
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
