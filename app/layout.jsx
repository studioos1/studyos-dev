import "./globals.css";
import Script from "next/script";

export const metadata = { title: "StudyOS" };
export const viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="stylesheet" href="/fonts/tabler-icons.min.css" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&family=Syne:wght@700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        {children}
        {/* pdf.js is used client-side by the syllabus/schedule PDF parser. */}
        <Script
          src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"
          strategy="beforeInteractive"
        />
      </body>
    </html>
  );
}
