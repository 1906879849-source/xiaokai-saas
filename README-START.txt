XIAOKAI KIE V1.3 - Windows startup

Recommended:
1. Keep the whole project in one folder, for example:
   C:\Users\凯\Desktop\无限画布\kai-interface-preview
2. Double-click start.cmd (recommended instead of start.bat).
3. If .env is missing or the key is empty, Notepad opens it.
4. Fill:
   KIE_API_KEY=your_real_kie_key
5. Save and close Notepad, then continue.
6. Open:
   http://127.0.0.1:4318

Manual fallback if start.cmd still fails:
1. Open CMD.
2. Run exactly:
   cd /d "C:\Users\凯\Desktop\无限画布\kai-interface-preview"
   npm install
   node server.js
3. Keep that CMD window open.
4. Open http://127.0.0.1:4318

Important:
- Opening index.html directly can test UI only.
- Real Kie generation requires server.js running, because the Kie API key must stay on the backend.
