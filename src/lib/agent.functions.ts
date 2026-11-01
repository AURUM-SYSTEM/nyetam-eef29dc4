import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Un agent ne reçoit que les missions qui lui sont personnellement affectées.
export const listMyAgentAssignments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles").select("organization_id").eq("id", context.userId).single();
    if (profileError || !(profile as any)?.organization_id) {
      throw new Error("Organisation de l'agent introuvable.");
    }
    const { data, error } = await supabaseAdmin
      .from("agent_assignments")
      .select("id,title,instructions,module_type,status,starts_at,due_at,created_at")
      .eq("agent_user_id", context.userId)
      .eq("organization_id", (profile as any).organization_id)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return { assignments: data ?? [] };
  });
