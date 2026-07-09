CREATE TABLE public.documents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('rapport','pv')),
  title TEXT NOT NULL DEFAULT 'Document sans titre',
  transcript TEXT NOT NULL DEFAULT '',
  introduction TEXT NOT NULL DEFAULT '',
  faits TEXT NOT NULL DEFAULT '',
  declarations TEXT NOT NULL DEFAULT '',
  conclusion TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

-- MVP demo: no auth, public access
CREATE POLICY "public read documents" ON public.documents FOR SELECT USING (true);
CREATE POLICY "public insert documents" ON public.documents FOR INSERT WITH CHECK (true);
CREATE POLICY "public update documents" ON public.documents FOR UPDATE USING (true);
CREATE POLICY "public delete documents" ON public.documents FOR DELETE USING (true);

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

CREATE TRIGGER documents_touch_updated_at
BEFORE UPDATE ON public.documents
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();