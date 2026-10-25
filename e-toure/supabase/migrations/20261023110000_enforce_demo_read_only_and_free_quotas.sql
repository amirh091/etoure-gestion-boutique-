DO $$
BEGIN
    IF to_regclass('public.produits') IS NULL
       OR to_regclass('public.ventes') IS NULL
       OR to_regclass('public.lignes_vente') IS NULL
       OR to_regclass('public.remboursements') IS NULL THEN
        RAISE EXCEPTION 'Demo and quota protections require produits, ventes, lignes_vente, and remboursements tables.';
    END IF;

    IF to_regprocedure('public.est_utilisateur_premium()') IS NULL
       OR to_regprocedure('public.periode_essai_autorise_ecriture()') IS NULL THEN
        RAISE EXCEPTION 'Demo and quota protections require the Premium and trial migrations to be applied first.';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.est_compte_demo()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT COALESCE(
        auth.jwt() -> 'app_metadata' ->> 'is_demo' = 'true'
        OR auth.jwt() -> 'app_metadata' ->> 'role' = 'demo'
        OR lower(auth.jwt() ->> 'email') = 'demo@bafingpro.com',
        false
    );
$$;

CREATE OR REPLACE FUNCTION public.refuser_ecriture_compte_demo()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF auth.uid() IS NULL AND auth.role() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'Authentication is required.'
            USING ERRCODE = '42501';
    END IF;

    IF auth.uid() IS NOT NULL AND public.est_compte_demo() THEN
        RAISE EXCEPTION 'Demo account is read-only.'
            USING ERRCODE = '42501';
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.appliquer_limite_produits_gratuits()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    utilisateur_id uuid := auth.uid();
    nombre_produits bigint;
BEGIN
    IF auth.role() = 'service_role' THEN
        RETURN NEW;
    END IF;

    IF utilisateur_id IS NULL OR NEW.user_id IS DISTINCT FROM utilisateur_id THEN
        RAISE EXCEPTION 'Product owner must match the authenticated user.'
            USING ERRCODE = '42501';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(utilisateur_id::text, 0)
    );

    IF public.est_utilisateur_premium() THEN
        RETURN NEW;
    END IF;

    IF NOT public.periode_essai_autorise_ecriture() THEN
        RAISE EXCEPTION 'Trial period has expired.'
            USING ERRCODE = '42501';
    END IF;

    SELECT count(*)
    INTO nombre_produits
    FROM public.produits
    WHERE user_id = utilisateur_id;

    IF nombre_produits >= 20 THEN
        RAISE EXCEPTION 'Free plan product limit reached.'
            USING ERRCODE = 'P0001';
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.appliquer_limite_ventes_gratuites()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    utilisateur_id uuid := auth.uid();
    nombre_ventes bigint;
BEGIN
    IF auth.role() = 'service_role' THEN
        RETURN NEW;
    END IF;

    IF utilisateur_id IS NULL OR NEW.user_id IS DISTINCT FROM utilisateur_id THEN
        RAISE EXCEPTION 'Sale owner must match the authenticated user.'
            USING ERRCODE = '42501';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(utilisateur_id::text, 0)
    );

    IF public.est_utilisateur_premium() THEN
        RETURN NEW;
    END IF;

    IF NOT public.periode_essai_autorise_ecriture() THEN
        RAISE EXCEPTION 'Trial period has expired.'
            USING ERRCODE = '42501';
    END IF;

    SELECT count(*)
    INTO nombre_ventes
    FROM public.ventes
    WHERE user_id = utilisateur_id
      AND (TG_OP = 'INSERT' OR id <> OLD.id)
      AND date_vente >= date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
      AND date_vente < (date_trunc('month', now() AT TIME ZONE 'UTC') + interval '1 month') AT TIME ZONE 'UTC';

    IF nombre_ventes >= 20 THEN
        RAISE EXCEPTION 'Free plan monthly sale limit reached.'
            USING ERRCODE = 'P0001';
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.verifier_ligne_vente_compte()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    utilisateur_id uuid := auth.uid();
    proprietaire_vente uuid;
    proprietaire_produit uuid;
BEGIN
    IF auth.role() = 'service_role' THEN
        RETURN NEW;
    END IF;

    IF utilisateur_id IS NULL THEN
        RAISE EXCEPTION 'Authentication is required.'
            USING ERRCODE = '42501';
    END IF;

    SELECT user_id
    INTO proprietaire_vente
    FROM public.ventes
    WHERE id = NEW.vente_id;

    SELECT user_id
    INTO proprietaire_produit
    FROM public.produits
    WHERE id = NEW.produit_id;

    IF proprietaire_vente IS DISTINCT FROM utilisateur_id
       OR proprietaire_produit IS DISTINCT FROM utilisateur_id THEN
        RAISE EXCEPTION 'Sale line must reference records owned by the authenticated user.'
            USING ERRCODE = '42501';
    END IF;

    IF public.est_compte_demo() THEN
        RAISE EXCEPTION 'Demo account is read-only.'
            USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.verifier_remboursement_compte()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    utilisateur_id uuid := auth.uid();
    proprietaire_vente uuid;
BEGIN
    IF auth.role() = 'service_role' THEN
        RETURN NEW;
    END IF;

    IF utilisateur_id IS NULL OR NEW.user_id IS DISTINCT FROM utilisateur_id THEN
        RAISE EXCEPTION 'Refund owner must match the authenticated user.'
            USING ERRCODE = '42501';
    END IF;

    SELECT user_id
    INTO proprietaire_vente
    FROM public.ventes
    WHERE id = NEW.vente_id;

    IF proprietaire_vente IS DISTINCT FROM utilisateur_id THEN
        RAISE EXCEPTION 'Refund must reference a sale owned by the authenticated user.'
            USING ERRCODE = '42501';
    END IF;

    IF public.est_compte_demo() THEN
        RAISE EXCEPTION 'Demo account is read-only.'
            USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS refuser_ecriture_demo_produits ON public.produits;
CREATE TRIGGER refuser_ecriture_demo_produits
    BEFORE INSERT OR UPDATE OR DELETE ON public.produits
    FOR EACH ROW EXECUTE FUNCTION public.refuser_ecriture_compte_demo();

DROP TRIGGER IF EXISTS refuser_ecriture_demo_ventes ON public.ventes;
CREATE TRIGGER refuser_ecriture_demo_ventes
    BEFORE INSERT OR UPDATE OR DELETE ON public.ventes
    FOR EACH ROW EXECUTE FUNCTION public.refuser_ecriture_compte_demo();

DROP TRIGGER IF EXISTS refuser_ecriture_demo_lignes_vente ON public.lignes_vente;
CREATE TRIGGER refuser_ecriture_demo_lignes_vente
    BEFORE INSERT OR UPDATE OR DELETE ON public.lignes_vente
    FOR EACH ROW EXECUTE FUNCTION public.refuser_ecriture_compte_demo();

DROP TRIGGER IF EXISTS refuser_ecriture_demo_remboursements ON public.remboursements;
CREATE TRIGGER refuser_ecriture_demo_remboursements
    BEFORE INSERT OR UPDATE OR DELETE ON public.remboursements
    FOR EACH ROW EXECUTE FUNCTION public.refuser_ecriture_compte_demo();

DROP TRIGGER IF EXISTS appliquer_limite_produits_gratuits ON public.produits;
CREATE TRIGGER appliquer_limite_produits_gratuits
    BEFORE INSERT ON public.produits
    FOR EACH ROW EXECUTE FUNCTION public.appliquer_limite_produits_gratuits();

DROP TRIGGER IF EXISTS appliquer_limite_ventes_gratuites ON public.ventes;
CREATE TRIGGER appliquer_limite_ventes_gratuites
    BEFORE INSERT ON public.ventes
    FOR EACH ROW EXECUTE FUNCTION public.appliquer_limite_ventes_gratuites();

DROP TRIGGER IF EXISTS appliquer_limite_ventes_gratuites_update ON public.ventes;
CREATE TRIGGER appliquer_limite_ventes_gratuites_update
    BEFORE UPDATE OF date_vente ON public.ventes
    FOR EACH ROW EXECUTE FUNCTION public.appliquer_limite_ventes_gratuites();

DROP TRIGGER IF EXISTS verifier_ligne_vente_compte ON public.lignes_vente;
CREATE TRIGGER verifier_ligne_vente_compte
    BEFORE INSERT OR UPDATE ON public.lignes_vente
    FOR EACH ROW EXECUTE FUNCTION public.verifier_ligne_vente_compte();

DROP TRIGGER IF EXISTS verifier_remboursement_compte ON public.remboursements;
CREATE TRIGGER verifier_remboursement_compte
    BEFORE INSERT OR UPDATE ON public.remboursements
    FOR EACH ROW EXECUTE FUNCTION public.verifier_remboursement_compte();

ALTER TABLE public.produits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ventes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lignes_vente ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.remboursements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS periode_essai_remboursements ON public.remboursements;
CREATE POLICY periode_essai_remboursements
    ON public.remboursements
    AS RESTRICTIVE
    FOR INSERT
    TO public
    WITH CHECK (public.periode_essai_autorise_ecriture());

DROP POLICY IF EXISTS periode_essai_update_remboursements ON public.remboursements;
CREATE POLICY periode_essai_update_remboursements
    ON public.remboursements
    AS RESTRICTIVE
    FOR UPDATE
    TO public
    USING (public.periode_essai_autorise_ecriture())
    WITH CHECK (public.periode_essai_autorise_ecriture());

DROP POLICY IF EXISTS periode_essai_delete_remboursements ON public.remboursements;
CREATE POLICY periode_essai_delete_remboursements
    ON public.remboursements
    AS RESTRICTIVE
    FOR DELETE
    TO public
    USING (public.periode_essai_autorise_ecriture());

DROP POLICY IF EXISTS tenant_produits ON public.produits;
CREATE POLICY tenant_produits
    ON public.produits
    AS RESTRICTIVE
    FOR ALL
    TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS tenant_ventes ON public.ventes;
CREATE POLICY tenant_ventes
    ON public.ventes
    AS RESTRICTIVE
    FOR ALL
    TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS tenant_lignes_vente ON public.lignes_vente;
CREATE POLICY tenant_lignes_vente
    ON public.lignes_vente
    AS RESTRICTIVE
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.ventes
            WHERE ventes.id = lignes_vente.vente_id
              AND ventes.user_id = auth.uid()
        )
        AND EXISTS (
            SELECT 1
            FROM public.produits
            WHERE produits.id = lignes_vente.produit_id
              AND produits.user_id = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM public.ventes
            WHERE ventes.id = lignes_vente.vente_id
              AND ventes.user_id = auth.uid()
        )
        AND EXISTS (
            SELECT 1
            FROM public.produits
            WHERE produits.id = lignes_vente.produit_id
              AND produits.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS tenant_remboursements ON public.remboursements;
CREATE POLICY tenant_remboursements
    ON public.remboursements
    AS RESTRICTIVE
    FOR ALL
    TO authenticated
    USING (
        user_id = auth.uid()
        AND EXISTS (
            SELECT 1
            FROM public.ventes
            WHERE ventes.id = remboursements.vente_id
              AND ventes.user_id = auth.uid()
        )
    )
    WITH CHECK (
        user_id = auth.uid()
        AND EXISTS (
            SELECT 1
            FROM public.ventes
            WHERE ventes.id = remboursements.vente_id
              AND ventes.user_id = auth.uid()
        )
    );

REVOKE ALL ON FUNCTION public.est_compte_demo() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.refuser_ecriture_compte_demo() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.appliquer_limite_produits_gratuits() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.appliquer_limite_ventes_gratuites() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.verifier_ligne_vente_compte() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.verifier_remboursement_compte() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.est_compte_demo() TO authenticated;
