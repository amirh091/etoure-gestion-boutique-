const SUPABASE_URL = 'https://agmtrcuwjaresydkezlf.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFnbXRyY3V3amFyZXN5ZGtlemxmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI2NjQ4MzYsImV4cCI6MjEwODI0MDgzNn0.8On4F92gcoSM1iM0jHU9Y2sjLXuHnXcFAEd68VJvlWU';

// On n'écrase pas la variable si les clés n'ont pas été configurées
let supabaseClient;
try {
    if (!SUPABASE_URL || !SUPABASE_URL.startsWith('http')) {
        console.error('BAFING PRO : configurez SUPABASE_URL et SUPABASE_KEY dans js/supabase-client.js !');
    } else {
        const { createClient } = supabase;
        supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY);
    }
} catch (err) {
    console.error('BAFING PRO : échec de l\'initialisation de Supabase :', err);
}