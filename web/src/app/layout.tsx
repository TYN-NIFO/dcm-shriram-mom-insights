import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DCM MoM Insights",
  description: "Ask questions about Board and Committee minutes. Every answer cites the minute-book page.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f7f7f7",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("mom-theme");if(t==="blue"){document.documentElement.dataset.theme="blue";var f=function(){document.querySelectorAll('link[rel~="icon"]').forEach(function(l){l.href="/icon-blue.png"})};f();document.addEventListener("DOMContentLoaded",f)}}catch(e){}`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
