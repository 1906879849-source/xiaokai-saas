XIAOKAI SAAS V1 - Windows

1. Double-click start.cmd.
2. First run: fill KIE_API_KEY in .env.
3. Optional: fill ADMIN_EMAIL with your own login email.
4. Open http://127.0.0.1:4318/
5. Register / login.
6. Use Billing -> test top-up.
7. Dashboard -> create canvas -> generate images.

Important:
- Real online payment is NOT connected yet. Billing uses local test top-up.
- Kie API Key stays on the backend.
- V1 account/project/wallet data is stored in data/db.json for local testing.
- Production should move data to PostgreSQL/MySQL and replace test top-up with real payment callbacks.
