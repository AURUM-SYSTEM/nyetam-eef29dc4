import { createContext, createElement, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type AurumUserProfile = {
  id: string;
  full_name: string;
  email: string;
  country: string;
  profession: string;
  preferred_lang: "fr" | "en";
  secteur_activite: string;
  role_metier: string;

};

const PROFILE_CACHE_KEY = "aurum.user.profile";

type AuthCtx = {
  loading: boolean;
  session: Session | null;
  user: User | null;
  profile: AurumUserProfile | null;
  refreshProfile: () => Promise<AurumUserProfile | null>;
  updateProfile: (patch: Partial<Omit<AurumUserProfile, "id" | "email">>) => Promise<AurumUserProfile | null>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthCtx>({
  loading: true,
  session: null,
  user: null,
  profile: null,
  refreshProfile: async () => null,
  updateProfile: async () => null,
  signOut: async () => {},
});

export function getCachedProfile(): AurumUserProfile | null {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(PROFILE_CACHE_KEY) : null;
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function setCachedProfile(p: AurumUserProfile | null) {
  try {
    if (p) localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(p));
    else localStorage.removeItem(PROFILE_CACHE_KEY);
  } catch {}
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<AurumUserProfile | null>(() => getCachedProfile());
  const [loading, setLoading] = useState(true);
  const fetchedFor = useRef<string | null>(null);

  async function fetchProfile(userId: string): Promise<AurumUserProfile | null> {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, full_name, email, country, profession, preferred_lang, secteur_activite, role_metier")
      .eq("id", userId)
      .maybeSingle();
    if (error || !data) return null;
    const p = {
      ...data,
      preferred_lang: (data.preferred_lang === "en" ? "en" : "fr"),
      secteur_activite: (data as any).secteur_activite || "ong_humanitaire",
      role_metier: (data as any).role_metier || "agent_terrain",
    } as AurumUserProfile;

    setProfile(p);
    setCachedProfile(p);
    return p;
  }

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
      if (sess?.user) {
        if (fetchedFor.current !== sess.user.id) {
          fetchedFor.current = sess.user.id;
          setTimeout(() => { void fetchProfile(sess.user.id); }, 0);
        }
      } else {
        fetchedFor.current = null;
        setProfile(null);
        setCachedProfile(null);
      }
    });

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session?.user) {
        fetchedFor.current = data.session.user.id;
        void fetchProfile(data.session.user.id);
      }
      setLoading(false);
    });

    return () => { subscription.unsubscribe(); };
  }, []);

  const value = useMemo<AuthCtx>(() => ({
    loading,
    session,
    user: session?.user ?? null,
    profile,
    refreshProfile: async () => session?.user ? fetchProfile(session.user.id) : null,
    updateProfile: async (patch) => {
      if (!session?.user) return null;
      const { data, error } = await supabase
        .from("profiles")
        .update(patch)
        .eq("id", session.user.id)
        .select("id, full_name, email, country, profession, preferred_lang, secteur_activite, role_metier")
        .single();
      if (error || !data) return null;
      const p = {
        ...data,
        preferred_lang: (data.preferred_lang === "en" ? "en" : "fr"),
        secteur_activite: (data as any).secteur_activite || "ong_humanitaire",
        role_metier: (data as any).role_metier || "agent_terrain",
      } as AurumUserProfile;

      setProfile(p);
      setCachedProfile(p);
      return p;
    },
    signOut: async () => {
      await supabase.auth.signOut();
      setProfile(null);
      setCachedProfile(null);
    },
  }), [loading, session, profile]);

  return createElement(Ctx.Provider, { value }, children);
}

export function useAuth() { return useContext(Ctx); }
