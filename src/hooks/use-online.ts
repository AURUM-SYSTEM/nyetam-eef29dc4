import { useEffect, useState } from "react";

export function useOnline() {
  // Start with `true` on both server and initial client render to avoid
  // SSR hydration mismatch, then sync to the real value after mount.
  const [online, setOnline] = useState<boolean>(true);
  useEffect(() => {
    setOnline(navigator.onLine);
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return online;
}
