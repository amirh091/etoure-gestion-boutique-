// =========================================
// BAFING PRO - Protection des pages
// =========================================

let etatEssai = null;
let erreurEtatEssai = null;
let afficherToastTimeout;

async function verifierConnexion() {
  // Garde : si Supabase n'est pas initialisé (clés manquantes ou script non chargé)
  if (typeof supabaseClient === "undefined") {
    console.error("BAFING PRO : supabaseClient introuvable. Vérifiez js/supabase-client.js.");
    alert("Erreur de configuration : connexion au serveur impossible.");
    window.location.href = "connexion.html";
    return null;
  }

  // On vérifie s'il y a une session active
  const {
    data: { session },
    error,
  } = await supabaseClient.auth.getSession();

  if (error) {
    console.error("Erreur de session :", error.message);
    window.location.href = "connexion.html";
    return null;
  }

  // Si pas de session, on redirige vers la page de connexion
  if (!session) {
    window.location.href = "connexion.html";
    return null;
  }

  const { data: profil, error: erreurProfil } = await supabaseClient
    .from("profils")
    .select("role")
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (erreurProfil) {
    console.error("Impossible de vérifier le rôle utilisateur :", erreurProfil);
    etatEssai = null;
    afficherBanniereEssai(
      null,
      "Configuration Supabase incomplète : impossible de lire public.profils. L’administrateur doit appliquer les migrations Supabase."
    );
    return session.user;
  }

  if (!profil) {
    console.error("Aucun profil Supabase n'existe pour l'utilisateur :", session.user.id);
    etatEssai = null;
    afficherBanniereEssai(
      null,
      "Profil introuvable dans public.profils. L’administrateur doit appliquer les migrations Supabase puis vous reconnecter."
    );
    return session.user;
  }

  const estSuperAdmin = profil?.role === "super_admin";
  const { data: essai, error: erreurEssai } = await supabaseClient.rpc("etat_essai");
  if (erreurEssai || !essai) {
    console.error("Impossible de vérifier la période d'essai :", erreurEssai);
    etatEssai = null;
    erreurEtatEssai = erreurEssai;
    if (!estSuperAdmin) {
      const configurationInvalide =
        erreurEssai?.code === "42P01" ||
        erreurEssai?.code === "PGRST202" ||
        erreurEssai?.code === "42883" ||
        erreurEssai?.status === 404 ||
        /could not find (the )?function|schema cache|function .* does not exist/i.test(
          erreurEssai?.message || ""
        );
      afficherBanniereEssai(
        null,
        erreurEssai?.code === "42P01" &&
          /profils/i.test(erreurEssai?.message || "")
          ? "La base Supabase n’a pas la table public.profils. Appliquez d’abord la migration 20261022170000_profiles_bootstrap.sql, puis les migrations Premium et période d’essai."
          : configurationInvalide
          ? "Supabase ne trouve pas la fonction RPC etat_essai(). Appliquez la migration 20261022180000_trial_period.sql dans le bon projet, puis rechargez le schéma API Supabase et reconnectez-vous."
          : "Impossible de vérifier votre période d’essai. Consultez l’erreur Supabase dans la console et réessayez."
      );
    }
  } else {
    etatEssai = essai;
    erreurEtatEssai = null;
    if (!estSuperAdmin) afficherBanniereEssai(essai);
  }

  return session.user;
}

function afficherBanniereEssai(essai, messageErreur) {
  let banniere = document.getElementById("banniere-essai");
  if (!banniere) {
    banniere = document.createElement("div");
    banniere.id = "banniere-essai";
  }
  banniere.setAttribute("role", "status");
  banniere.style.cssText =
    "padding:0.85rem 1rem;margin-bottom:1rem;border-radius:8px;background:#fff3e0;border:1px solid #ffe0b2;color:#7c3d00;";

  if (!essai) {
    banniere.textContent = messageErreur ||
      "Impossible de vérifier votre période d’essai. Les ajouts et ventes sont temporairement désactivés.";
  } else if (essai.est_premium) {
    banniere.textContent = "Votre compte E-TOURÉ Premium est actif.";
    banniere.style.background = "#e8f5e9";
    banniere.style.borderColor = "#c8e6c9";
    banniere.style.color = "#1b5e20";
  } else {
    const dateExpiration = new Date(essai.expire_le);
    const dateFormatee = dateExpiration.toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });

    if (essai.essai_actif) {
      banniere.textContent = `Essai gratuit jusqu’au ${dateFormatee}. Après cette date, l’ajout de produits et les ventes seront désactivés.`;
    } else {
      banniere.textContent = `Votre période d’essai a expiré le ${dateFormatee}. Vous pouvez consulter vos données, mais vous ne pouvez plus ajouter de produits ni enregistrer de ventes.`;
      banniere.style.background = "#ffebee";
      banniere.style.borderColor = "#ffcdd2";
      banniere.style.color = "#b71c1c";
    }
  }

  const main = document.querySelector(".main-content");
  const header = main && main.querySelector("header");
  if (!banniere.isConnected && header) {
    header.insertAdjacentElement("afterend", banniere);
  } else if (!banniere.isConnected) {
    document.body.prepend(banniere);
  }
}

async function verifierDroitEssai() {
  const essaiEncoreActif =
    etatEssai && new Date(etatEssai.expire_le).getTime() > Date.now();
  if (etatEssai && (etatEssai.est_premium || essaiEncoreActif)) {
    return true;
  }

  if (!etatEssai) {
    if (erreurEtatEssai?.code === "42P01" && /profils/i.test(erreurEtatEssai.message || "")) {
      alert("L’ajout est bloqué car la table public.profils manque dans Supabase. Appliquez la migration 20261022170000_profiles_bootstrap.sql, puis les migrations Premium et période d’essai.");
      return false;
    }
    if (erreurEtatEssai) {
      console.error("Échec de la vérification d'accès à la période d'essai :", erreurEtatEssai);
    }
    alert("Impossible de vérifier votre période d’essai. Veuillez réessayer avant de continuer.");
    return false;
  }

  const dateExpiration = new Date(etatEssai.expire_le).toLocaleDateString("fr-FR");
  alert(
    `Votre période d’essai a expiré le ${dateExpiration}. Vous ne pouvez plus ajouter de produits ni enregistrer de ventes.`
  );
  return false;
}

async function estModeDemo() {
  if (typeof supabaseClient === "undefined") {
    throw new Error("Le client Supabase n'est pas configuré.");
  }

  const { data, error } = await supabaseClient.auth.getSession();
  if (error) throw error;

  const user = data?.session?.user;
  if (!user) return false;

  return user.app_metadata?.is_demo === true ||
    user.app_metadata?.role === "demo" ||
    user.email?.toLowerCase() === "demo@bafingpro.com";
}

function afficherToast(message, type = "info") {
  let toast = document.getElementById("notification-hors-ligne");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "notification-hors-ligne";
    toast.setAttribute("role", "status");
    toast.style.cssText =
      "position:fixed;right:1rem;bottom:1rem;z-index:2000;max-width:calc(100% - 2rem);padding:0.85rem 1rem;border-radius:8px;color:#fff;box-shadow:0 2px 10px #0003;";
    document.body.appendChild(toast);
  }

  const couleurs = {
    success: "#2e7d32",
    warning: "#ed6c02",
    error: "#c62828",
    info: "#1565c0",
  };
  toast.style.background = couleurs[type] || couleurs.info;
  toast.textContent = message;
  toast.hidden = false;

  clearTimeout(afficherToastTimeout);
  afficherToastTimeout = setTimeout(() => {
    toast.hidden = true;
  }, 6000);
}

// Fonction globale de déconnexion
async function deconnexion() {
  if (typeof supabaseClient !== "undefined") {
    await supabaseClient.auth.signOut();
  }
  window.location.href = "connexion.html";
}

// Utilitaire anti-XSS : échapper le HTML avant injection dans le DOM
function echapperHTML(texte) {
  return String(texte ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
// Afficher le bouton Super Admin si l'utilisateur a le rôle
async function afficherBoutonAdmin(user) {
  // Si l'utilisateur n'est pas passé en paramètre, on le récupère
  if (!user) {
    const { data: { user: u } } = await supabaseClient.auth.getUser();
    user = u;
  }
  if (!user) return;

  const { data: profil, error } = await supabaseClient
    .from("profils")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("Impossible de récupérer le rôle utilisateur :", error);
    return;
  }

  if (profil && profil.role === "super_admin") {
    const nav = document.querySelector(".sidebar nav");
    if (nav && !document.querySelector('a[href="super-admin.html"]')) {
      const link = document.createElement("a");
      link.href = "super-admin.html";
      link.textContent = "👑 Super Admin";
      // Insérer après le Dashboard
      nav.insertBefore(link, nav.children[1]);
    }
  }
}

// =========================================
// MENU HAMBURGER (mobile)
// =========================================
function toggleMenuPro() {
  const sidebar = document.getElementById("sidebar-pro");
  if (sidebar) {
    sidebar.classList.toggle("active");
  }
}

// =========================================
// PWA : enregistrement du Service Worker
// =========================================
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./sw.js")
      .then(() => console.log("Service Worker E-TOURÉ enregistré"))
      .catch((err) => console.error("Erreur SW:", err));
  });
}