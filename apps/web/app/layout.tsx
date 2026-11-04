import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth";
import { ThemeProvider } from "@/lib/theme";

/** Applied pre-paint so the saved theme never flashes. */
const themeScript = `(function(){try{if(localStorage.getItem("fieldfix.theme")==="light"){document.documentElement.dataset.theme="light"}}catch(e){}})();`;

export const metadata: Metadata = {
  title: "FieldFix AI · Device Troubleshooting",
  description:
    "Evidence-driven troubleshooting for laptops, desktops, and smartphones. Diagnose with AI, stay safe, share the report.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // The blocking theme script sets data-theme pre-paint, so the client
    // HTML intentionally differs from SSR on the first render.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      {/* Browser extensions (e.g. Grammarly) inject body attributes that
          would otherwise trip hydration mismatch warnings. */}
      <body suppressHydrationWarning>
        <ThemeProvider>
          <AuthProvider>{children}</AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
