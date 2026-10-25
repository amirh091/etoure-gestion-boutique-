document.addEventListener('DOMContentLoaded', async () => {
    const dateElement = document.getElementById('current-date');
    const heureElement = document.getElementById('current-heure');
    const formateurDate = new Intl.DateTimeFormat('fr-FR', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric'
    });
    const formateurHeure = new Intl.DateTimeFormat('fr-FR', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23'
    });
    let dateHeureTimer;

    const afficherDateHeure = () => {
        const maintenant = new Date();
        dateElement.textContent = formateurDate.format(maintenant);
        heureElement.textContent = formateurHeure.format(maintenant);
        dateElement.dateTime = maintenant.toISOString();
        heureElement.dateTime = maintenant.toISOString();
        dateHeureTimer = window.setTimeout(
            afficherDateHeure,
            1000 - maintenant.getMilliseconds()
        );
    };

    afficherDateHeure();
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            window.clearTimeout(dateHeureTimer);
            afficherDateHeure();
        }
    });

    // 2. Vérifier si l'utilisateur est connecté
    const user = await verifierConnexion();
    if (!user) return;

    // 2bis. Afficher le bouton Super Admin si l'utilisateur a le rôle
    await afficherBoutonAdmin(user);

    const { data: profilAdmin, error: erreurProfilAdmin } = await supabaseClient
        .from('profils')
        .select('role')
        .eq('user_id', user.id)
        .maybeSingle();

    if (erreurProfilAdmin) {
        console.error("Impossible de vérifier le rôle administrateur :", erreurProfilAdmin);
    }

    const estSuperAdmin = profilAdmin?.role === 'super_admin';
    if (estSuperAdmin) {
        const banniereEssai = document.getElementById('banniere-essai');
        const bannierePremium = document.getElementById('banniere-premium');
        if (banniereEssai) banniereEssai.style.display = 'none';
        if (bannierePremium) bannierePremium.style.display = 'none';
    }

    // Afficher la bannière Premium si l'utilisateur est en offre gratuite.
    const { data: estPremium, error: erreurPremium } = await supabaseClient.rpc('est_utilisateur_premium');
    if (erreurPremium) {
        console.error(erreurPremium);
        alert("Impossible de vérifier votre statut Premium. Veuillez réessayer.");
    } else if (!estSuperAdmin && !estPremium) {
        document.getElementById('banniere-premium').style.display = 'flex';
    }

    // 3. Récupérer les données pour les statistiques
    // a. Les ventes du jour
    const aujourdhui = new Date();
    aujourdhui.setHours(0, 0, 0, 0); // Début de la journée

    const { data: ventesJour, error: errVentes } = await supabaseClient
        .from('ventes')
        .select('total')
        .eq('user_id', user.id)
        .gte('date_vente', aujourdhui.toISOString());

    let totalJour = 0;
    if (ventesJour && ventesJour.length > 0) {
        totalJour = ventesJour.reduce((sum, v) => sum + v.total, 0);
    }
    document.getElementById('stat-ventes').textContent = totalJour.toLocaleString('fr-FR') + ' FCFA';
    document.getElementById('stat-transactions').textContent = ventesJour ? ventesJour.length : 0;

    // b. Les produits en alerte (stock <= seuil_alerte)
    const { data: produits, error: errProduits } = await supabaseClient
        .from('produits')
        .select('*')
        .eq('user_id', user.id);

    let alertes = 0;
    if (produits) {
        alertes = produits.filter(p => p.stock <= p.seuil_alerte).length;
    }
    document.getElementById('stat-alertes').textContent = alertes;

    // c. Calculer le total des dettes en cours
    const { data: ventesImpayees, error: errDettes } = await supabaseClient
        .from('ventes')
        .select('montant_restant')
        .eq('user_id', user.id)
        .eq('est_payee', false);

    if (errDettes) console.error(errDettes);

    let totalDettes = 0;
    if (ventesImpayees) {
        totalDettes = ventesImpayees.reduce((sum, v) => sum + (v.montant_restant || 0), 0);
    }
    document.getElementById('stat-dettes').textContent = totalDettes.toLocaleString('fr-FR') + ' FCFA';

    // 4. Créer le graphique des 7 derniers jours
    await creerGraphique(user.id);
});

// Fonction pour créer le graphique (une seule requête pour les 7 derniers jours)
async function creerGraphique(userId) {
    const ctx = document.getElementById('salesChart').getContext('2d');

    // Préparer les 7 derniers jours
    const labels = [];
    const dataVentes = [];

    const debut = new Date();
    debut.setDate(debut.getDate() - 6);
    debut.setHours(0, 0, 0, 0);
    const fin = new Date();
    fin.setHours(23, 59, 59, 999);

    // Récupérer toutes les ventes des 7 derniers jours en une seule requête
    const { data: ventes, error: errVentes } = await supabaseClient
        .from('ventes')
        .select('total, date_vente')
        .eq('user_id', userId)
        .gte('date_vente', debut.toISOString())
        .lte('date_vente', fin.toISOString());

    if (errVentes) return console.error(errVentes);

    for (let i = 6; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        date.setHours(0, 0, 0, 0);

        const dateFin = new Date(date);
        dateFin.setHours(23, 59, 59, 999);

        // Formater le label (ex: "Lun 12")
        labels.push(date.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' }));

        // Somme des ventes de ce jour
        const total = (ventes || [])
            .filter(v => {
                const d = new Date(v.date_vente);
                return d >= date && d <= dateFin;
            })
            .reduce((sum, v) => sum + v.total, 0);
        dataVentes.push(total);
    }

    // Créer le graphique avec Chart.js
    new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Ventes (FCFA)',
                data: dataVentes,
                borderColor: '#00BFA6', // Vert Bafing
                backgroundColor: 'rgba(0, 191, 166, 0.1)',
                borderWidth: 3,
                tension: 0.4, // Courbe arrondie
                fill: true,
                pointBackgroundColor: '#1A237E',
                pointBorderColor: '#fff',
                pointRadius: 4
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function(value) {
                            return value.toLocaleString('fr-FR') + ' F';
                        }
                    }
                }
            }
        }
    });
}
function toggleMenu() {
    document.querySelector('.sidebar').classList.toggle('active');
}