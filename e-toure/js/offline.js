// ==========================================
// BAFING PRO - Gestion du mode hors-ligne
// ==========================================

const CLE_VENTES_HORS_LIGNE = 'bafing_pro_ventes_attente';
let synchronisationEnCours = false;

function cleVentesHorsLigne(userId) {
    return `${CLE_VENTES_HORS_LIGNE}_${userId}`;
}

function lireVentesHorsLigne(userId) {
    const ventes = JSON.parse(localStorage.getItem(cleVentesHorsLigne(userId)) || '[]');
    if (!Array.isArray(ventes)) {
        throw new Error('La file locale des ventes est invalide.');
    }
    return ventes;
}

function ecrireVentesHorsLigne(userId, ventes) {
    localStorage.setItem(cleVentesHorsLigne(userId), JSON.stringify(ventes));
}

function nouvelIdentifiantLocal() {
    if (crypto.randomUUID) return crypto.randomUUID();

    const valeurs = new Uint8Array(16);
    crypto.getRandomValues(valeurs);
    valeurs[6] = (valeurs[6] & 0x0f) | 0x40;
    valeurs[8] = (valeurs[8] & 0x3f) | 0x80;
    const hex = Array.from(valeurs, valeur => valeur.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function sauvegarderVenteHorsLigne(vente) {
    if (!vente || !vente.infoVente || !vente.infoVente.user_id) {
        throw new Error('Données de vente hors-ligne invalides.');
    }

    const ventes = lireVentesHorsLigne(vente.infoVente.user_id);
    const idLocal = nouvelIdentifiantLocal();
    ventes.push({
        ...vente,
        id_local: idLocal,
        vente_id: null,
        lignes_synchronisees: false,
        remboursement_synchronise: false,
        stocks_synchronises: []
    });
    ecrireVentesHorsLigne(vente.infoVente.user_id, ventes);

    afficherToast('Vente enregistrée localement. Elle reste à synchroniser.', 'warning');
    return idLocal;
}

function mettreAJourVenteEnAttente(userId, venteActualisee) {
    const ventes = lireVentesHorsLigne(userId);
    const index = ventes.findIndex(vente => vente.id_local === venteActualisee.id_local);
    if (index < 0) {
        throw new Error('La vente en attente a disparu du stockage local.');
    }
    ventes[index] = venteActualisee;
    ecrireVentesHorsLigne(userId, ventes);
}

async function synchroniserLignesVente(vente) {
    if (vente.lignes_synchronisees) return vente;

    const lignes = vente.lignes.map(ligne => ({
        ...ligne,
        vente_id: vente.vente_id
    }));
    const { error } = await supabaseClient.from('lignes_vente').insert(lignes);
    if (error) throw error;

    vente.lignes_synchronisees = true;
    mettreAJourVenteEnAttente(vente.infoVente.user_id, vente);
    return vente;
}

async function synchroniserRemboursementInitial(vente) {
    if (vente.remboursement_synchronise) return vente;

    if (vente.montant_paye > 0) {
        const { error } = await supabaseClient.from('remboursements').insert([{
            vente_id: vente.vente_id,
            montant: vente.montant_paye,
            user_id: vente.infoVente.user_id
        }]);
        if (error) throw error;
    }

    vente.remboursement_synchronise = true;
    mettreAJourVenteEnAttente(vente.infoVente.user_id, vente);
    return vente;
}

async function synchroniserStocksVente(vente) {
    const produitsSynchronises = new Set(vente.stocks_synchronises);

    for (const produit of vente.produits) {
        if (produitsSynchronises.has(produit.id)) continue;

        let stockMisAJour = false;
        for (let tentative = 0; tentative < 3; tentative++) {
            const { data: produitActuel, error: erreurLecture } = await supabaseClient
                .from('produits')
                .select('stock')
                .eq('id', produit.id)
                .eq('user_id', vente.infoVente.user_id)
                .maybeSingle();

            if (erreurLecture) throw erreurLecture;
            if (!produitActuel) throw new Error(`Produit ${produit.id} introuvable pour ce compte.`);
            if (produitActuel.stock < produit.quantite) {
                throw new Error(`Stock insuffisant pour le produit ${produit.id} ; vente à vérifier manuellement.`);
            }

            const { data: resultat, error: erreurMiseAJour } = await supabaseClient
                .from('produits')
                .update({ stock: produitActuel.stock - produit.quantite })
                .eq('id', produit.id)
                .eq('user_id', vente.infoVente.user_id)
                .eq('stock', produitActuel.stock)
                .select('id')
                .maybeSingle();

            if (erreurMiseAJour) throw erreurMiseAJour;
            if (resultat) {
                stockMisAJour = true;
                break;
            }
        }

        if (!stockMisAJour) {
            throw new Error(`Le stock du produit ${produit.id} change trop souvent ; vente à vérifier manuellement.`);
        }

        produitsSynchronises.add(produit.id);
        vente.stocks_synchronises = Array.from(produitsSynchronises);
        mettreAJourVenteEnAttente(vente.infoVente.user_id, vente);
    }

    return vente;
}

async function synchroniserVentes() {
    if (synchronisationEnCours || !navigator.onLine || typeof supabaseClient === 'undefined') return;
    synchronisationEnCours = true;

    try {
        const { data: { user }, error: erreurUtilisateur } = await supabaseClient.auth.getUser();
        if (erreurUtilisateur) throw erreurUtilisateur;
        if (!user) return;
        if (await estModeDemo()) return;

        const ventes = lireVentesHorsLigne(user.id);
        if (ventes.length === 0) return;

        let nombreEchecs = 0;
        for (const vente of ventes) {
            if (vente.infoVente.user_id !== user.id) continue;

            try {
                if (!vente.vente_id) {
                    const { data: venteCreee, error } = await supabaseClient
                        .from('ventes')
                        .insert([vente.infoVente])
                        .select('id')
                        .single();
                    if (error) throw error;

                    vente.vente_id = venteCreee.id;
                    mettreAJourVenteEnAttente(user.id, vente);
                }

                await synchroniserLignesVente(vente);
                await synchroniserRemboursementInitial(vente);
                await synchroniserStocksVente(vente);

                const ventesRestantes = lireVentesHorsLigne(user.id)
                    .filter(venteEnAttente => venteEnAttente.id_local !== vente.id_local);
                ecrireVentesHorsLigne(user.id, ventesRestantes);
            } catch (error) {
                nombreEchecs++;
                console.error(`Échec de synchronisation de la vente locale ${vente.id_local} :`, error);
            }
        }

        const ventesRestantes = lireVentesHorsLigne(user.id);
        if (ventesRestantes.length === 0) {
            afficherToast('Toutes vos ventes hors-ligne ont été synchronisées.', 'success');
        } else if (nombreEchecs > 0) {
            afficherToast(`${nombreEchecs} vente(s) restent à synchroniser ou nécessitent une vérification.`, 'error');
        }
    } catch (error) {
        console.error('Impossible de synchroniser les ventes hors-ligne :', error);
        afficherToast('Synchronisation impossible. Vos ventes restent enregistrées sur cet appareil.', 'error');
    } finally {
        synchronisationEnCours = false;
    }
}

window.addEventListener('online', () => {
    afficherToast('Connexion rétablie. Synchronisation des ventes en attente...', 'info');
    synchroniserVentes();
});

window.addEventListener('offline', () => {
    afficherToast('Vous êtes hors-ligne. Les ventes peuvent être mises en attente sur cet appareil.', 'warning');
});

document.addEventListener('DOMContentLoaded', () => {
    if (navigator.onLine) synchroniserVentes();
});
