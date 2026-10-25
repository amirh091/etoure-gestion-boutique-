let produitsGlobaux = [];

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Vérifier la connexion
    const user = await verifierConnexion();
    if (!user) return;

    // 1bis. Afficher le bouton Super Admin si l'utilisateur a le rôle
    await afficherBoutonAdmin(user);

    // 2. Charger les produits
    await chargerProduits(user.id);

    // 3. Gérer la soumission du formulaire
    document.getElementById('form-produit').addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
            if (await estModeDemo()) {
                afficherToast("Mode démo : L'ajout de produits est désactivé.", "warning");
                return;
            }
        } catch (error) {
            console.error("Impossible de vérifier le mode démo :", error);
            alert("Impossible de vérifier les autorisations. L'ajout est annulé ; réessayez.");
            return;
        }

        if (!(await verifierDroitEssai())) return;

        const btn = e.target.querySelector('button[type="submit"]');
        btn.textContent = "Enregistrement...";
        btn.disabled = true;

        // Vérifier les limites de l'offre gratuite avant l'ajout.
        const { data: estPremium, error: erreurPremium } = await supabaseClient.rpc('est_utilisateur_premium');
        const { data: nbProduits, error: erreurProduits } = await supabaseClient.rpc('compter_produits');

        if (erreurPremium || erreurProduits || typeof nbProduits !== 'number') {
            console.error(erreurPremium || erreurProduits || 'Nombre de produits invalide.');
            alert("Impossible de vérifier votre offre et le nombre de produits. Veuillez réessayer.");
            btn.textContent = "Enregistrer";
            btn.disabled = false;
            return;
        }

        if (!estPremium && nbProduits >= 20) {
            alert("Limite atteinte ! Vous avez 20 produits (offre gratuite). Passez à E-TOURÉ Premium pour des produits illimités.\n\nContactez-nous sur WhatsApp : +225 07 XX XX XX XX");
            btn.textContent = "Enregistrer";
            btn.disabled = false;
            return;
        }

        const nouveauProduit = {
            user_id: user.id,
            nom: document.getElementById('nom').value,
            prix: parseInt(document.getElementById('prix').value),
            stock: parseInt(document.getElementById('stock').value),
            seuil_alerte: parseInt(document.getElementById('seuil').value),
            code_barres: document.getElementById('code-barres').value.trim() || null
        };

        const { error } = await supabaseClient.from('produits').insert([nouveauProduit]);

        if (error) {
            alert("Erreur : " + error.message);
        } else {
            fermerModal();
            document.getElementById('form-produit').reset();
            await chargerProduits(user.id); // Recharger la liste
        }
        
        btn.textContent = "Enregistrer";
        btn.disabled = false;
    });
});

async function chargerProduits(userId) {
    const { data, error } = await supabaseClient
        .from('produits')
        .select('*')
        .eq('user_id', userId)
        .order('nom', { ascending: true });

    if (error) return console.error(error);
    
    produitsGlobaux = data;
    const tbody = document.getElementById('liste-produits');
    
    if (data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:#888;">Aucun produit. Cliquez sur "Nouveau Produit" pour commencer.</td></tr>`;
        return;
    }

    tbody.innerHTML = data.map(produit => {
        const estAlerte = produit.stock <= produit.seuil_alerte;
        return `
            <tr>
                <td>
                    <strong>${echapperHTML(produit.nom)}</strong><br>
                    <small style="color:#888;">${echapperHTML(produit.code_barres || 'Sans code')}</small>
                </td>
                <td data-label="Prix">${produit.prix.toLocaleString('fr-FR')} FCFA</td>
                <td data-label="Stock" class="${estAlerte ? 'stock-alerte' : ''}">
                    ${produit.stock} ${estAlerte ? '⚠️' : ''}
                </td>
                <td data-label="Actions">
                    <button onclick="ajusterStock(${produit.id}, 1)" class="btn-outline" style="padding: 0.3rem 0.6rem; font-size: 0.8rem;">+1</button>
                    <button onclick="ajusterStock(${produit.id}, -1)" class="btn-outline" style="padding: 0.3rem 0.6rem; font-size: 0.8rem; border-color: #d32f2f; color: #d32f2f;">-1</button>
                </td>
            </tr>
        `;
    }).join('');
}

// Gestion de la fenêtre modale
function ouvrirModal() { document.getElementById('modal-produit').classList.add('active'); }
function fermerModal() { document.getElementById('modal-produit').classList.remove('active'); }

// Ajuster le stock rapidement
window.ajusterStock = async (produitId, delta) => {
    try {
        if (await estModeDemo()) {
            afficherToast("Mode démo : La modification du stock est désactivée.", "warning");
            return;
        }
    } catch (error) {
        console.error("Impossible de vérifier le mode démo :", error);
        alert("Impossible de vérifier les autorisations. La modification du stock est annulée ; réessayez.");
        return;
    }

    if (!(await verifierDroitEssai())) return;

    const produit = produitsGlobaux.find(p => p.id === produitId);
    if (!produit) return;

    const nouveauStock = produit.stock + delta;
    if (nouveauStock < 0) return alert("Le stock ne peut pas être négatif.");

    const { error } = await supabaseClient
        .from('produits')
        .update({ stock: nouveauStock })
        .eq('id', produitId);

    if (error) alert("Erreur : " + error.message);
    else {
        await chargerProduits(user.id);
    }
};