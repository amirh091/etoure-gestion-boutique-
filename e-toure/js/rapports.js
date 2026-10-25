document.addEventListener('DOMContentLoaded', async () => {
    // 1. Vérifier la connexion
    const user = await verifierConnexion();
    if (!user) return;

    // 1bis. Afficher le bouton Super Admin si l'utilisateur a le rôle
    await afficherBoutonAdmin(user);

    // 2. Récupérer toutes les ventes de l'utilisateur
    const { data: ventes, error: errVentes } = await supabaseClient
        .from('ventes')
        .select('*')
        .eq('user_id', user.id);

    if (errVentes) return console.error(errVentes);

    // 3. Calculer les statistiques de base
    const totalCA = ventes.reduce((sum, v) => sum + v.total, 0);
    const nbVentes = ventes.length;
    const panierMoyen = nbVentes > 0 ? totalCA / nbVentes : 0;

    document.getElementById('total-ca').textContent = totalCA.toLocaleString('fr-FR') + ' FCFA';
    document.getElementById('total-ventes').textContent = nbVentes;
    document.getElementById('panier-moyen').textContent = panierMoyen.toLocaleString('fr-FR', { maximumFractionDigits: 0 }) + ' FCFA';

    // 4. Récupérer les lignes de vente pour calculer le top des produits
    // On récupère les lignes de vente liées aux ventes de cet utilisateur
    const ventesIds = ventes.map(v => v.id);
    
    if (ventesIds.length > 0) {
        const { data: lignes, error: errLignes } = await supabaseClient
            .from('lignes_vente')
            .select('produit_id, quantite, produits(nom)')
            .in('vente_id', ventesIds);

        if (errLignes) return console.error(errLignes);

        // 5. Agréger les quantités par produit
        const produitsMap = {};
        lignes.forEach(ligne => {
            const nom = ligne.produits ? ligne.produits.nom : 'Produit inconnu';
            if (!produitsMap[nom]) produitsMap[nom] = 0;
            produitsMap[nom] += ligne.quantite;
        });

        // 6. Trier et prendre le Top 5
        const topProduits = Object.entries(produitsMap)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);

        // 7. Créer le graphique
        creerGraphiqueTopProduits(topProduits);
    } else {
        // Si aucune vente, on affiche un graphique vide
        creerGraphiqueTopProduits([]);
    }
});

function creerGraphiqueTopProduits(topProduits) {
    const ctx = document.getElementById('topProduitsChart').getContext('2d');
    
    const labels = topProduits.map(p => p[0]);
    const data = topProduits.map(p => p[1]);

    if (labels.length === 0) {
        // Si pas de données, on met un texte par défaut
        document.getElementById('topProduitsChart').style.display = 'none';
        document.querySelector('.chart-section').innerHTML += '<p style="text-align: center; color: #888;">Aucune vente enregistrée pour le moment.</p>';
        return;
    }

    new Chart(ctx, {
        type: 'bar', // Graphique en barres
        data: {
            labels: labels,
            datasets: [{
                label: 'Quantité vendue',
                data: data,
                backgroundColor: [
                    '#00BFA6', // Vert Bafing
                    '#1A237E', // Bleu Nuit
                    '#FFCA28', // Jaune
                    '#F44336', // Rouge
                    '#9C27B0'  // Violet
                ],
                borderRadius: 6
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
                    ticks: { stepSize: 1 }
                }
            }
        }
    });
}