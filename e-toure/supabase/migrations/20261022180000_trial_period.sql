DO $$
BEGIN
    IF to_regclass('public.produits') IS NULL
       OR to_regclass('public.ventes') IS NULL
       OR to_regclass('public.lignes_vente') IS NULL THEN
        RAISE EXCEPTION 'Trial migration requires public.produits, public.ventes, and public.lignes_vente.';
    END IF;

    IF to_regprocedure('public.est_utilisateur_premium()') IS NULL THEN
        RAISE EXCEPTION 'Trial migration requires public.est_utilisateur_premium().';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.compter_produits()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication is required.';
    END IF;

    RETURN (
        SELECT count(*)
        FROM public.produits
        WHERE user_id = auth.uid()
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.compter_ventes_mois()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication is required.';
    END IF;

    RETURN (
        SELECT count(*)
        FROM public.ventes
        WHERE user_id = auth.uid()
          AND date_vente >= (
              date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
          )
    );
END;
$$;

CREATE TABLE IF NOT EXISTS public.periodes_essai (
    user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    commence_le timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE public.periodes_essai ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.periodes_essai FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.etat_essai()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    utilisateur_id uuid := auth.uid();
    debut_essai timestamptz;
    premium boolean;
    expiration timestamptz;
BEGIN
    IF utilisateur_id IS NULL THEN
        RAISE EXCEPTION 'Authentication is required.';
    END IF;

    INSERT INTO public.periodes_essai (user_id)
    VALUES (utilisateur_id)
    ON CONFLICT (user_id) DO NOTHING;

    SELECT commence_le
    INTO debut_essai
    FROM public.periodes_essai
    WHERE user_id = utilisateur_id;

    expiration := debut_essai + interval '14 days';
    premium := COALESCE(public.est_utilisateur_premium(), false);

    RETURN jsonb_build_object(
        'commence_le', debut_essai,
        'expire_le', expiration,
        'est_premium', premium,
        'essai_actif', clock_timestamp() < expiration
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.periode_essai_autorise_ecriture()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT CASE
        WHEN auth.uid() IS NULL THEN false
        ELSE COALESCE(public.est_utilisateur_premium(), false)
            OR EXISTS (
                SELECT 1
                FROM public.periodes_essai
                WHERE user_id = auth.uid()
                  AND commence_le + interval '14 days' > now()
            )
    END;
$$;

REVOKE ALL ON FUNCTION public.etat_essai() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.periode_essai_autorise_ecriture() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.compter_produits() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.compter_ventes_mois() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.etat_essai() TO authenticated;
GRANT EXECUTE ON FUNCTION public.periode_essai_autorise_ecriture() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.compter_produits() TO authenticated;
GRANT EXECUTE ON FUNCTION public.compter_ventes_mois() TO authenticated;

ALTER TABLE public.produits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ventes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lignes_vente ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS periode_essai_produits ON public.produits;
CREATE POLICY periode_essai_produits
    ON public.produits
    AS RESTRICTIVE
    FOR INSERT
    TO public
    WITH CHECK (public.periode_essai_autorise_ecriture());

DROP POLICY IF EXISTS periode_essai_update_produits ON public.produits;
CREATE POLICY periode_essai_update_produits
    ON public.produits
    AS RESTRICTIVE
    FOR UPDATE
    TO public
    USING (public.periode_essai_autorise_ecriture())
    WITH CHECK (public.periode_essai_autorise_ecriture());

DROP POLICY IF EXISTS periode_essai_delete_produits ON public.produits;
CREATE POLICY periode_essai_delete_produits
    ON public.produits
    AS RESTRICTIVE
    FOR DELETE
    TO public
    USING (public.periode_essai_autorise_ecriture());

DROP POLICY IF EXISTS periode_essai_ventes ON public.ventes;
CREATE POLICY periode_essai_ventes
    ON public.ventes
    AS RESTRICTIVE
    FOR INSERT
    TO public
    WITH CHECK (public.periode_essai_autorise_ecriture());

DROP POLICY IF EXISTS periode_essai_update_ventes ON public.ventes;
CREATE POLICY periode_essai_update_ventes
    ON public.ventes
    AS RESTRICTIVE
    FOR UPDATE
    TO public
    USING (public.periode_essai_autorise_ecriture())
    WITH CHECK (public.periode_essai_autorise_ecriture());

DROP POLICY IF EXISTS periode_essai_delete_ventes ON public.ventes;
CREATE POLICY periode_essai_delete_ventes
    ON public.ventes
    AS RESTRICTIVE
    FOR DELETE
    TO public
    USING (public.periode_essai_autorise_ecriture());

DROP POLICY IF EXISTS periode_essai_lignes_vente ON public.lignes_vente;
CREATE POLICY periode_essai_lignes_vente
    ON public.lignes_vente
    AS RESTRICTIVE
    FOR INSERT
    TO public
    WITH CHECK (public.periode_essai_autorise_ecriture());

DROP POLICY IF EXISTS periode_essai_update_lignes_vente ON public.lignes_vente;
CREATE POLICY periode_essai_update_lignes_vente
    ON public.lignes_vente
    AS RESTRICTIVE
    FOR UPDATE
    TO public
    USING (public.periode_essai_autorise_ecriture())
    WITH CHECK (public.periode_essai_autorise_ecriture());

DROP POLICY IF EXISTS periode_essai_delete_lignes_vente ON public.lignes_vente;
CREATE POLICY periode_essai_delete_lignes_vente
    ON public.lignes_vente
    AS RESTRICTIVE
    FOR DELETE
    TO public
    USING (public.periode_essai_autorise_ecriture());
