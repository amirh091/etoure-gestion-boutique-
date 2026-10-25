DO $$
BEGIN
    IF to_regclass('public.profils') IS NULL THEN
        RAISE EXCEPTION 'Premium management requires public.profils.';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'profils'
          AND column_name = 'user_id'
    ) OR NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'profils'
          AND column_name = 'role'
    ) THEN
        RAISE EXCEPTION 'Premium management requires public.profils.user_id and public.profils.role.';
    END IF;
END;
$$;

ALTER TABLE public.profils
    ADD COLUMN IF NOT EXISTS est_premium boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS date_expiration_premium timestamptz;

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

CREATE OR REPLACE FUNCTION public.admin_definir_premium(p_user_id uuid, p_actif boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    role_appelant text;
    role_cible text;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication is required.';
    END IF;
    IF p_user_id IS NULL OR p_actif IS NULL THEN
        RAISE EXCEPTION 'A target user and a Premium state are required.';
    END IF;

    SELECT role
    INTO role_appelant
    FROM public.profils
    WHERE user_id = auth.uid();

    IF role_appelant IS DISTINCT FROM 'super_admin' THEN
        RAISE EXCEPTION 'Only a super administrator can change Premium status.';
    END IF;

    SELECT role
    INTO role_cible
    FROM public.profils
    WHERE user_id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Target profile does not exist.';
    END IF;
    IF role_cible = 'super_admin' THEN
        RAISE EXCEPTION 'Premium status cannot be changed for a super administrator.';
    END IF;

    UPDATE public.profils
    SET est_premium = p_actif,
        date_expiration_premium = CASE
            WHEN p_actif THEN now() + interval '30 days'
            ELSE NULL
        END
    WHERE user_id = p_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.proteger_champs_statut_premium()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    proprietaire_fonction text;
BEGIN
    IF NEW.est_premium IS DISTINCT FROM OLD.est_premium
       OR NEW.date_expiration_premium IS DISTINCT FROM OLD.date_expiration_premium THEN
        SELECT pg_catalog.pg_get_userbyid(proowner)
        INTO proprietaire_fonction
        FROM pg_catalog.pg_proc
        WHERE oid = 'public.admin_definir_premium(uuid,boolean)'::regprocedure;

        IF current_user IS DISTINCT FROM proprietaire_fonction THEN
            RAISE EXCEPTION 'Premium status can only be changed through the administrator function.';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS proteger_champs_statut_premium ON public.profils;
CREATE TRIGGER proteger_champs_statut_premium
    BEFORE UPDATE OF est_premium, date_expiration_premium
    ON public.profils
    FOR EACH ROW
    EXECUTE FUNCTION public.proteger_champs_statut_premium();

REVOKE ALL ON FUNCTION public.est_utilisateur_premium() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_definir_premium(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.est_utilisateur_premium() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_definir_premium(uuid, boolean) TO authenticated;
