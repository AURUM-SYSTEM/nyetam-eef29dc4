import { useState, useEffect } from "react";
import { useI18n } from "@/i18n";
import { Smartphone, X, Share, MoreVertical, Download } from "lucide-react";

const DISMISS_KEY = "aurum.install_guide_dismissed";

function isMobile() {
  if (typeof navigator === "undefined") return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  );
}

function isStandalone() {
  if (typeof window === "undefined") return false;
  const mq = window.matchMedia("(display-mode: standalone)");
  // iOS
  if ("standalone" in navigator && (navigator as any).standalone === true) return true;
  // Android / standard
  return mq.matches;
}

export function InstallGuide() {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  const [isIos, setIsIos] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;
    if (!isMobile()) return;
    try {
      if (localStorage.getItem(DISMISS_KEY) === "1") return;
    } catch {}
    setIsIos(/iPhone|iPad|iPod/i.test(navigator.userAgent));
    setVisible(true);
  }, []);

  function dismiss() {
    setVisible(false);
    try { localStorage.setItem(DISMISS_KEY, "1"); } catch {}
  }

  if (!visible) return null;

  return (
    <div className="glass-card relative mb-6 rounded-xl p-4">
      <button
        onClick={dismiss}
        className="absolute right-2 top-2 rounded-md p-1 text-muted-foreground hover:text-foreground"
        aria-label={t("common.close")}
      >
        <X className="h-4 w-4" />
      </button>

      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent">
          <Smartphone className="h-5 w-5 text-gold" />
        </div>
        <div>
          <p className="text-sm font-medium">{t("install.title")}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("install.sub")}</p>

          <div className="mt-3 space-y-2 text-xs text-muted-foreground">
            {isIos ? (
              <div className="flex items-center gap-2 rounded-lg bg-card/60 px-3 py-2">
                <Share className="h-3.5 w-3.5 shrink-0 text-gold" />
                <span>{t("install.ios_steps")}</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-lg bg-card/60 px-3 py-2">
                <MoreVertical className="h-3.5 w-3.5 shrink-0 text-gold" />
                <span>{t("install.android_steps")}</span>
              </div>
            )}
          </div>

          <p className="mt-2 text-[11px] text-muted-foreground italic">
            {t("install.note")}
          </p>
        </div>
      </div>
    </div>
  );
}
