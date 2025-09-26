# MVP TODO (Admin Panel)

This update adds an Admin Panel gated by admin email verification via Supabase Edge Function `app_6571a533ec_admin`.

Files to create/update (<=8 files):
1) src/components/AdminPanel.tsx
   - UI to show Traffic (Today/7d/30d), list blocked IPs
   - Actions: Reset Leaderboard, Block IP, Unblock IP, Clear Abuse
   - Calls edge function with Bearer token

2) src/App.tsx
   - Add /admin route

3) src/pages/Index.tsx
   - Detect isAdmin by calling the verifier
   - Show an "Admin" entry in the menu or a visible link/button for admins to access /admin

Notes:
- Keep UI minimal and mobile-friendly (shadcn/ui components)
- No changes to DB schema are required for MVP
- Edge Function `app_6571a533ec_admin` already deployed and will handle actions securely (server-side admin verification)