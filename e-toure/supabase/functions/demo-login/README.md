# Secure demo login

The demo login function returns a Supabase session for a dedicated demo account. It never sends the account password to the browser. Do not use a staff or customer account for this purpose.

## Required safeguards

Before deploying the function:

1. Create a dedicated demo user and populate it only with fictional demonstration data.
2. Configure Row Level Security so that this user can only read the intended demo rows and cannot insert, update, or delete business data in any exposed table or RPC.
3. Verify the policies using a session for the demo user. A frontend-only disabled button is not an authorization control.
4. Configure the exact public website origin in `DEMO_ALLOWED_ORIGIN`. Preview/staging deployments need their own exact allowed origin.
5. Store `DEMO_EMAIL` and `DEMO_PASSWORD` as Supabase Edge Function secrets. Never put them in HTML, JavaScript, repository files, or browser storage.
6. Rotate the demo account password before deployment if it was previously used in client-side code; configure only the new password as the `DEMO_PASSWORD` secret.

## Configure and deploy

Set these Edge Function secrets in the Supabase Dashboard:

- `DEMO_ALLOWED_ORIGIN`: exact origin, such as `https://example.com` (no trailing path)
- `DEMO_EMAIL`: dedicated demo account email
- `DEMO_PASSWORD`: dedicated demo account password

Supabase provides `SUPABASE_URL` and `SUPABASE_ANON_KEY` to Edge Functions. This function is public so visitors who are not logged in can request the demo session; its handler validates the exact allowed origin. Deploy `demo-login` with the Supabase CLI after linking this project:

```text
supabase functions deploy demo-login
```

The browser calls `demo-login`, receives a short-lived access token and refresh token, then establishes the session through the Supabase client. Protect every exposed table with RLS; the function's CORS check is not authorization.

The account credentials are deliberately kept in Edge Function secrets, never in client code. The database migration `supabase/migrations/20261023110000_enforce_demo_read_only_and_free_quotas.sql` adds database-side write restrictions for the demo account and enforces the free-plan product and monthly-sale limits.
