CREATE TABLE IF NOT EXISTS public.profils (
    user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    nom_boutique text,
    role text NOT NULL DEFAULT 'commercant'
        CHECK (role IN ('commercant', 'super_admin')),
    created_at timestamptz NOT NULL DEFAULT now(),
    est_premium boolean NOT NULL DEFAULT false,
    date_expiration_premium timestamptz
);

ALTER TABLE public.profils
    ADD COLUMN IF NOT EXISTS nom_boutique text,
    ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'commercant',
    ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS est_premium boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS date_expiration_premium timestamptz;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'profils'
          AND column_name = 'user_id'
    ) THEN
        RAISE EXCEPTION 'public.profils must contain a user_id column referencing auth.users(id).';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.creer_profil_nouvel_utilisateur()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    INSERT INTO public.profils (user_id, nom_boutique, role)
    VALUES (
        NEW.id,
        NULLIF(pg_catalog.btrim(NEW.raw_user_meta_data ->> 'nom_boutique'), ''),
        CASE
            WHEN NEW.raw_app_meta_data ->> 'role' = 'super_admin' THEN 'super_admin'
            ELSE 'commercant'
        END
    )
    ON CONFLICT (user_id) DO NOTHING;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS creer_profil_apres_inscription ON auth.users;
CREATE TRIGGER creer_profil_apres_inscription
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.creer_profil_nouvel_utilisateur();

INSERT INTO public.profils (user_id, role)
SELECT
    id,
    CASE
        WHEN raw_app_meta_data ->> 'role' = 'super_admin' THEN 'super_admin'
        ELSE 'commercant'
    END
FROM auth.users
ON CONFLICT (user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.est_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.profils
        WHERE user_id = auth.uid()
          AND role = 'super_admin'
    );
$$;

CREATE OR REPLACE FUNCTION public.est_utilisateur_premium()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.profils
        WHERE user_id = auth.uid()
          AND est_premium IS TRUE
          AND date_expiration_premium > now()
    );
$$;

ALTER TABLE public.profils ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.profils FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.profils TO authenticated;

DROP POLICY IF EXISTS profils_lire_son_profil_ou_admin ON public.profils;
CREATE POLICY profils_lire_son_profil_ou_admin
    ON public.profils
    FOR SELECT
    TO authenticated
    USING (user_id = auth.uid() OR public.est_super_admin());

REVOKE ALL ON FUNCTION public.creer_profil_nouvel_utilisateur() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.est_super_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.est_utilisateur_premium() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.est_super_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.est_utilisateur_premium() TO authenticated;
