// _authenticated.tsx (beforeLoad) et AuthProvider (use-auth.ts) appellent
// tous les deux supabase.auth.getSession() indépendamment, quasi en même
// temps, au chargement d'une route protégée. @supabase/auth-js ne mémoïse
// rien entre deux appels : si le premier tombe sur un jeton proche de
// l'expiration et retente un rafraîchissement réseau, le second répète
// exactement le même travail lent en parallèle ou juste après — deux
// attentes qui s'additionnent au lieu de se recouvrir, perçues comme un
// double délai (ex. ~10s au lieu de ~5s avant qu'un type de mission
// n'apparaisse). getSessionOnce() fait partager le même appel en vol aux
// deux appelants.
import { supabase } from "./client";

let inFlight: ReturnType<typeof supabase.auth.getSession> | null = null;

export function getSessionOnce() {
  if (!inFlight) {
    const promise = supabase.auth.getSession();
    inFlight = promise;
    void promise.finally(() => {
      // Libéré une fois résolu : un appel ultérieur (ex. après signOut puis
      // signIn) redéclenchera une vraie vérification plutôt que de servir
      // indéfiniment un résultat obsolète.
      if (inFlight === promise) inFlight = null;
    });
  }
  return inFlight;
}
