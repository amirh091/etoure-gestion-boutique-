# Déploiement de E-TOURÉ sur Vercel

L’application est un site statique : aucun build ni installation de dépendances n’est nécessaire.

## Publier le site

1. Envoyez les fichiers du projet vers un dépôt Git privé, puis importez ce dépôt dans Vercel.
2. Choisissez **Other** comme framework si Vercel ne détecte pas automatiquement le site.
3. Laissez la commande de build vide et définissez le répertoire de sortie sur `.` (racine du projet).
4. Déployez, puis associez le domaine définitif. Vercel fournit HTTPS automatiquement.

La configuration [vercel.json](./vercel.json) applique les en-têtes de sécurité. La caméra reste autorisée pour le lecteur de codes-barres. N’activez pas de politique CSP stricte sans adapter d’abord les scripts intégrés aux pages et les CDN utilisés par l’application.

## Configurer Supabase pour le domaine de production

Vercel héberge uniquement les pages et les ressources statiques. L’authentification, les données et la fonction `demo-login` restent hébergées sur Supabase.

1. Dans les paramètres Auth de Supabase, définissez l’URL du site et ajoutez le domaine de production aux URL de redirection autorisées.
2. Dans les secrets de la fonction Edge `demo-login`, définissez `DEMO_ALLOWED_ORIGIN` à l’origine exacte du site, par exemple `https://e-toure.example` (sans chemin ni barre oblique finale). Les déploiements Preview Vercel utiliseront une origine différente : ne les autorisez que si nécessaire.
3. Gardez `DEMO_EMAIL` et `DEMO_PASSWORD` dans les secrets Supabase uniquement. Utilisez un compte démo dédié et un mot de passe renouvelé.
4. Vérifiez que `js/supabase-client.js` contient uniquement la clé publique `anon`/`publishable` du projet, jamais une clé `service_role`.
5. Appliquez et vérifiez les migrations Supabase dans l’ordre prévu avant la mise en production. Confirmez les politiques RLS sur chaque table accessible, y compris celles qui ne sont pas dans le dépôt.

## Vérifications après déploiement

- Ouvrir la page de connexion et vérifier l’inscription, la connexion classique et le bouton démo.
- Vérifier les pages Produits, Point de Vente, Dettes, Rapports et Paramètres avec un compte de test.
- Tester l’installation PWA depuis un navigateur mobile sur le domaine HTTPS. Si une ancienne icône reste affichée, supprimer l’application installée puis la réinstaller.
- Vérifier le lecteur de code-barres depuis un appareil autorisant l’accès caméra.
- Contrôler la console du navigateur et les journaux Supabase. Les scripts CDN et les erreurs de configuration Supabase doivent être résolus avant la mise en production.
