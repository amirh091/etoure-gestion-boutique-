let tousLesProduits = [];
let panier = []; // Format: { produit: {...}, quantite: 1 }
let scannerActif = false;
let scanEnCours = false;

document.addEventListener('DOMContentLoaded', async () => {
    const user = await verifierConnexion();
    if (!user) return;

    await afficherBoutonAdmin(user);

    await chargerProduitsPOS(user.id);

    // Recherche
    document.getElementById('recherche-pos').addEventListener('input', (e) => {
        afficherProduitsPOS(e.target.value.toLowerCase());
    });

    // Bouton Encaisser
    document.getElementById('btn-valider-vente').addEventListener('click', () => enregistrerVente(user.id));
});

async function chargerProduitsPOS(userId) {
    const { data, error } = await supabaseClient
        .from('produits')
        .select('*')
        .eq('user_id', userId)
        .gt('stock', 0); // On n'affiche que les produits en stock

    if (error) return console.error(error);
    tousLesProduits = data;
    afficherProduitsPOS('');
}

function afficherProduitsPOS(recherche) {
    const grille = document.getElementById('grille-pos');
    const filtres = tousLesProduits.filter(p => p.nom.toLowerCase().includes(recherche));

    if (filtres.length === 0) {
        grille.innerHTML = `<p style="grid-column: 1/-1; text-align: center; color: #888;">Aucun produit trouvé.</p>`;
        return;
    }

    grille.innerHTML = filtres.map(p => `
        <div class="carte-pos" onclick="ajouterAuPanier(${p.id})">
            <h4>${echapperHTML(p.nom)}</h4>
            <p>${p.prix.toLocaleString('fr-FR')} F</p>
            <small>Stock: ${p.stock}</small>
        </div>
    `).join('');
}

window.ajouterAuPanier = (produitId) => {
    const produit = tousLesProduits.find(p => p.id === produitId);
    if (!produit) return;
    const itemExistant = panier.find(item => item.produit.id === produitId);

    if (itemExistant) {
        if (itemExistant.quantite < produit.stock) {
            itemExistant.quantite++;
        } else {
            alert("Stock maximum atteint pour ce produit.");
        }
    } else {
        panier.push({ produit: produit, quantite: 1 });
    }
    afficherPanier();
};

window.ouvrirScanner = () => {
    const conteneur = document.getElementById('scanner-container');
    const message = document.getElementById('scanner-message');
    conteneur.style.display = 'flex';
    message.textContent = '';

    if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
        message.textContent = 'La caméra nécessite une connexion sécurisée HTTPS.';
        return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
        message.textContent = 'La caméra n’est pas disponible dans ce navigateur.';
        return;
    }
    if (typeof Quagga === 'undefined') {
        message.textContent = 'Le scanner n’a pas pu se charger. Vérifiez votre connexion et réessayez.';
        return;
    }

    if (scannerActif) {
        Quagga.stop();
        scannerActif = false;
    }
    scanEnCours = false;

    Quagga.init({
        inputStream: {
            name: 'Live',
            type: 'LiveStream',
            target: document.getElementById('interactive'),
            constraints: {
                facingMode: { ideal: 'environment' }
            }
        },
        locator: { patchSize: 'medium', halfSample: true },
        numOfWorkers: navigator.hardwareConcurrency ? Math.min(navigator.hardwareConcurrency, 4) : 2,
        frequency: 10,
        decoder: {
            readers: ['ean_reader', 'ean_8_reader', 'upc_reader', 'upc_e_reader', 'code_128_reader', 'code_39_reader']
        },
        locate: true
    }, error => {
        if (error) {
            console.error('Impossible de démarrer le scanner :', error);
            message.textContent = 'Impossible d’accéder à la caméra. Vérifiez son autorisation, puis réessayez.';
            return;
        }

        scannerActif = true;
        Quagga.offDetected(traiterCodeBarres);
        Quagga.onDetected(traiterCodeBarres);
        Quagga.start();
    });
};

function traiterCodeBarres(resultat) {
    if (scanEnCours) return;
    const code = resultat?.codeResult?.code;
    if (!code) return;

    const correspondances = tousLesProduits.filter(produit => produit.code_barres === code);
    if (correspondances.length === 0) {
        document.getElementById('scanner-message').textContent = `Aucun produit trouvé pour le code ${code}.`;
        return;
    }
    if (correspondances.length > 1) {
        document.getElementById('scanner-message').textContent = 'Plusieurs produits utilisent ce code-barres. Corrigez les codes dans la liste des produits.';
        return;
    }

    scanEnCours = true;
    const produit = correspondances[0];
    fermerScanner();
    window.ajouterAuPanier(produit.id);
    document.getElementById('recherche-pos').value = '';
    afficherProduitsPOS('');
    afficherToast(`Produit ajouté : ${produit.nom}`, 'success');
}

window.fermerScanner = () => {
    if (typeof Quagga !== 'undefined') {
        Quagga.offDetected(traiterCodeBarres);
        if (scannerActif) Quagga.stop();
    }
    scannerActif = false;
    scanEnCours = false;
    document.getElementById('scanner-container').style.display = 'none';
};

document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && document.getElementById('scanner-container').style.display === 'flex') {
        fermerScanner();
    }
});

window.modifierQuantite = (produitId, delta) => {
    const item = panier.find(i => i.produit.id === produitId);
    if (!item) return;

    item.quantite += delta;

    if (item.quantite <= 0) {
        panier = panier.filter(i => i.produit.id !== produitId);
    } else if (item.quantite > item.produit.stock) {
        item.quantite = item.produit.stock; // Ne pas dépasser le stock
        alert("Stock maximum atteint.");
    }
    afficherPanier();
};

function afficherPanier() {
    const liste = document.getElementById('panier-liste');
    const btnValider = document.getElementById('btn-valider-vente');
    const totalSpan = document.getElementById('panier-total');

    if (panier.length === 0) {
        liste.innerHTML = `<p style="color: #888; text-align: center; margin-top: 2rem;">Le panier est vide.</p>`;
        totalSpan.textContent = "0 FCFA";
        btnValider.disabled = true;
        return;
    }

    let total = 0;
    liste.innerHTML = panier.map(item => {
        const sousTotal = item.produit.prix * item.quantite;
        total += sousTotal;
        return `
            <div class="item-panier">
                <div class="item-panier-info">
                    <h4>${echapperHTML(item.produit.nom)}</h4>
                    <small>${sousTotal.toLocaleString('fr-FR')} F</small>
                </div>
                <div class="item-panier-actions">
                    <button class="btn-qte" onclick="modifierQuantite(${item.produit.id}, -1)">-</button>
                    <span>${item.quantite}</span>
                    <button class="btn-qte" onclick="modifierQuantite(${item.produit.id}, 1)">+</button>
                </div>
            </div>
        `;
    }).join('');

    totalSpan.textContent = total.toLocaleString('fr-FR') + ' FCFA';
    btnValider.disabled = false;
}

async function enregistrerVente(userId) {
    if (panier.length === 0) return;
    try {
        if (await estModeDemo()) {
            afficherToast("Mode démo : Les ventes sont désactivées.", "warning");
            return;
        }
    } catch (error) {
        console.error("Impossible de vérifier le mode démo :", error);
        alert("Impossible de vérifier les autorisations. La vente est annulée ; réessayez.");
        return;
    }

    if (!(await verifierDroitEssai())) return;

    const isCredit = document.getElementById('toggle-credit').checked;
    const nomClient = document.getElementById('nom-client').value.trim();
    const montantPaye = parseInt(document.getElementById('montant-paye').value, 10) || 0;
    const totalVente = panier.reduce((sum, item) => sum + (item.produit.prix * item.quantite), 0);

    if (isCredit && !nomClient) {
        alert("Veuillez entrer le nom du client pour une vente à crédit.");
        return;
    }

    if (montantPaye < 0 || montantPaye > totalVente) {
        alert("Le montant payé doit être compris entre 0 et le total de la vente.");
        return;
    }

    if (!navigator.onLine) {
        const infoVente = {
            user_id: userId,
            total: totalVente,
            nom_client: isCredit ? nomClient : null,
            est_payee: !isCredit || montantPaye >= totalVente,
            montant_restant: isCredit ? totalVente - montantPaye : 0
        };
        const lignes = panier.map(item => ({
            produit_id: item.produit.id,
            quantite: item.quantite,
            prix_unitaire: item.produit.prix
        }));
        const produits = panier.map(item => ({
            id: item.produit.id,
            quantite: item.quantite
        }));

        try {
            const idLocal = sauvegarderVenteHorsLigne({
                infoVente,
                lignes,
                produits,
                montant_paye: isCredit ? montantPaye : 0
            });
            afficherRecu(`LOCAL-${idLocal.slice(0, 8)}`, totalVente, panier);
            panier = [];
            afficherPanier();
        } catch (error) {
            console.error("Impossible d'enregistrer la vente hors-ligne :", error);
            alert("La vente n'a pas été enregistrée. Vérifiez l'espace de stockage de cet appareil et réessayez.");
        }
        return;
    }

    const btnValider = document.getElementById('btn-valider-vente');
    btnValider.textContent = "Vérification...";
    btnValider.disabled = true;

    // Vérifier les limites de l'offre gratuite avant l'enregistrement.
    const { data: estPremium, error: erreurPremium } = await supabaseClient.rpc('est_utilisateur_premium');
    const { data: nbVentes, error: erreurVentes } = await supabaseClient.rpc('compter_ventes_mois');

    if (erreurPremium || erreurVentes || typeof nbVentes !== 'number') {
        console.error(erreurPremium || erreurVentes || 'Nombre de ventes invalide.');
        alert("Impossible de vérifier votre offre et le nombre de ventes. Veuillez réessayer.");
        btnValider.textContent = "Encaisser la vente";
        btnValider.disabled = false;
        return;
    }

    if (!estPremium && nbVentes >= 20) {
        alert("Limite atteinte ! Vous avez fait 20 ventes ce mois-ci (offre gratuite). Passez à E-TOURÉ Premium pour des ventes illimitées.\n\nContactez-nous sur WhatsApp : +225 07 XX XX XX XX");
        btnValider.textContent = "Encaisser la vente";
        btnValider.disabled = false;
        return;
    }

    btnValider.textContent = "Enregistrement...";

    const montantRestant = isCredit ? (totalVente - montantPaye) : 0;
    const estPayee = !isCredit || montantRestant <= 0;

    // Créer la vente avec les infos de crédit
    const { data: venteData, error: venteError } = await supabaseClient
        .from('ventes')
        .insert([{
            user_id: userId,
            total: totalVente,
            nom_client: isCredit ? nomClient : null,
            est_payee: estPayee,
            montant_restant: montantRestant
        }])
        .select()
        .single();

    if (venteError) {
        alert("Erreur lors de la vente : " + venteError.message);
        btnValider.textContent = "Encaisser la vente";
        btnValider.disabled = false;
        return;
    }

    const venteId = venteData.id;

    // 2. Créer les lignes de vente
    const lignes = panier.map(item => ({
        vente_id: venteId,
        produit_id: item.produit.id,
        quantite: item.quantite,
        prix_unitaire: item.produit.prix
    }));

    const { error: lignesError } = await supabaseClient.from('lignes_vente').insert(lignes);

    if (lignesError) {
        alert("Erreur lors de l'enregistrement des détails : " + lignesError.message);
    } else {
        // 3. Mettre à jour les stocks (en repartant du stock réel en base pour éviter les conflits)
        for (const item of panier) {
            const { data: produitActuel } = await supabaseClient
                .from('produits')
                .select('stock')
                .eq('id', item.produit.id)
                .single();

            const stockBase = produitActuel ? produitActuel.stock : item.produit.stock;
            const nouveauStock = Math.max(0, stockBase - item.quantite);
            await supabaseClient.from('produits').update({ stock: nouveauStock }).eq('id', item.produit.id);
        }

        // Préparer et afficher le reçu
        afficherRecu(venteId, totalVente, panier);

        panier = [];
        afficherPanier();
        // Recharger les produits pour mettre à jour les stocks affichés
        await chargerProduitsPOS(userId);
    }

    btnValider.textContent = "Encaisser la vente";
    btnValider.disabled = false;
}
// =========================================
// REÇU DE CAISSE
// =========================================

// Fonction pour remplir et afficher la fenêtre du reçu
function afficherRecu(idVente, total, contenuPanier) {
    document.getElementById('recu-date').textContent = new Date().toLocaleString('fr-FR');
    document.getElementById('recu-id').textContent = idVente.toString().padStart(6, '0'); // Ex: 000012
    document.getElementById('recu-total').textContent = total.toLocaleString('fr-FR') + ' FCFA';

    const lignesContainer = document.getElementById('recu-lignes');
    lignesContainer.innerHTML = contenuPanier.map(item => `
        <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
            <span>${item.quantite}x ${echapperHTML(item.produit.nom)}</span>
            <span>${(item.quantite * item.produit.prix).toLocaleString('fr-FR')} F</span>
        </div>
    `).join('');

    document.getElementById('modal-recu').classList.add('active');
}

// Fonction pour fermer le reçu
function fermerRecu() {
    document.getElementById('modal-recu').classList.remove('active');
}

// Fonction pour imprimer le reçu
function imprimerRecu() {
    window.print();
}

// Fonction pour afficher/masquer la zone de crédit
function activerCredit() {
    const isChecked = document.getElementById('toggle-credit').checked;
    document.getElementById('zone-credit').style.display = isChecked ? 'block' : 'none';
}
