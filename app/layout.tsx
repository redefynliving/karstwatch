import type { Metadata } from "next";
import { Mulish, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import "maplibre-gl/dist/maplibre-gl.css";

const mulish = Mulish({ subsets: ["latin"], variable: "--font-mulish" });
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex",
});

export const metadata: Metadata = {
  title: "KarstWatch — Sinkhole check for Bloomington",
  description:
    "Check land around Bloomington for sinkhole risk. Free public data, no account needed.",
  themeColor: "#2e7d5b",
  viewport: "width=device-width, initial-scale=1",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "KarstWatch",
  },
  icons: [
    { rel: "icon", sizes: "192x192", url: "/icon-192.png" },
    { rel: "apple-touch-icon", sizes: "192x192", url: "/icon-192.png" },
  ],
};

const bootWatchdog = `(function(){
  var RELOAD_KEY="kw_reload_once";
  var failed=false;
  function isChunkError(msg){
    return /ChunkLoadError|Loading chunk|dynamically imported module|error loading/i.test(msg||"");
  }
  function isAssetError(t){
    var s=(t&&(t.src||t.href))||"";
    return s.indexOf("/_next/static/")!==-1;
  }
  function showCard(msg){
    var ov=document.createElement("div");
    ov.style.cssText="position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;font-family:sans-serif";
    var card=document.createElement("div");
    card.style.cssText="background:#fff;border-radius:12px;padding:32px 28px;max-width:360px;width:90%;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,.18)";
    var h=document.createElement("p");
    h.style.cssText="margin:0 0 12px;font-size:16px;font-weight:700;color:#1a1a1a";
    h.textContent=msg;
    var btn=document.createElement("button");
    btn.textContent="Reload now";
    btn.style.cssText="margin-top:16px;padding:10px 24px;background:#2e7d5b;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer";
    btn.onclick=function(){location.reload();};
    var hint=document.createElement("p");
    hint.style.cssText="margin:12px 0 0;font-size:12px;color:#6b6b6b";
    hint.textContent="If this keeps happening, clear site data and reopen.";
    card.appendChild(h);card.appendChild(btn);card.appendChild(hint);
    ov.appendChild(card);document.body.appendChild(ov);
  }
  function onFailure(){
    if(failed)return;failed=true;
    if(navigator.onLine===false){
      showCard("You appear to be offline \u2014 reconnect and reload.");
      return;
    }
    if(!sessionStorage.getItem(RELOAD_KEY)){
      sessionStorage.setItem(RELOAD_KEY,"1");
      location.reload();
    }else{
      showCard("KarstWatch just updated \u2014 reload to finish.");
    }
  }
  window.addEventListener("error",function(e){
    if(isAssetError(e.target)||isChunkError(e.message))onFailure();
  },true);
  window.addEventListener("unhandledrejection",function(e){
    if(isChunkError(e.reason&&(e.reason.message||String(e.reason))))onFailure();
  });
  window.addEventListener("load",function(){
    if(!failed)sessionStorage.removeItem(RELOAD_KEY);
  });
})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${mulish.variable} ${plexMono.variable}`}>
      <head>
        <link rel="manifest" href="/manifest.json" />
        {/* Boot watchdog: detects chunk-load failures and auto-reloads or shows a card */}
        <script dangerouslySetInnerHTML={{ __html: bootWatchdog }} />
      </head>
      <body className="h-full font-sans antialiased">{children}</body>
    </html>
  );
}
