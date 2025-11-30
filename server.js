const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const app = express();

app.use(cors());
app.use(express.json());

// Konfiguracja Firebase
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
const dbUrl = process.env.FIREBASE_DB_URL;

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: dbUrl
});

const db = admin.database();

// --- POMOCNICY ---
function generateRandomId(length = 6) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// ✅ FIX: Funkcja czyszcząca klucze (np. zamienia kropki na podkreślniki)
function sanitizeKey(text) {
    if (!text) return "unknown_user";
    return text.toString().toLowerCase().trim().replace(/[.#$/[\]]/g, '_');
}

async function logAudit(gameId, action, description, meta = {}) {
    try {
        const safeMeta = JSON.parse(JSON.stringify(meta));
        await db.ref(`games/${gameId}/audit`).push({
            action,
            description,
            meta: safeMeta,
            timestamp: Date.now()
        });
    } catch (e) { console.error("Audit Error:", e); }
}

async function verifyTokenOptional(req, res, next) {
    const token = req.headers.authorization?.split('Bearer ')[1];
    if (token) {
        try {
            const decodedToken = await admin.auth().verifyIdToken(token);
            req.user = decodedToken;
        } catch (e) { console.log("Token invalid"); }
    }
    next();
}

// --- ENDPOINTY ---

// 1. CREATE GAME
app.post('/api/create-game', verifyTokenOptional, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Wymagane logowanie" });
    const { config, prizes } = req.body; 
    let gameId = null, isUnique = false, attempts = 0;

    while (!isUnique && attempts < 10) {
        gameId = generateRandomId(6);
        const snap = await db.ref(`games/${gameId}`).once('value');
        if (!snap.exists()) isUnique = true;
        attempts++;
    }
    if (!isUnique) return res.status(500).json({ error: "Błąd serwera" });

    await db.ref(`games/${gameId}`).set({
        adminUid: req.user.uid,
        config, prizes, createdAt: Date.now()
    });
    await logAudit(gameId, "GAME_CREATED", `Utworzono grę`);
    res.json({ success: true, gameId });
});

// 2. MY CREATED GAMES
app.get('/api/my-created-games', verifyTokenOptional, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Zaloguj się" });
    try {
        const ref = db.ref('games');
        const snapshot = await ref.orderByChild('adminUid').equalTo(req.user.uid).once('value');
        const games = [];
        snapshot.forEach(c => games.push({ id: c.key, createdAt: c.val().createdAt, prizesCount: c.val().prizes ? Object.keys(c.val().prizes).length : 0 }));
        games.sort((a, b) => b.createdAt - a.createdAt);
        res.json({ games });
    } catch (e) { res.status(500).json({ error: "Błąd serwera" }); }
});

// 3. MY WINNINGS
app.get('/api/my-winnings', verifyTokenOptional, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Zaloguj się" });
    try {
        const snapshot = await db.ref('games').limitToLast(100).once('value'); 
        const winnings = [];
        snapshot.forEach(c => {
            const g = c.val();
            if (g.prizes) Object.values(g.prizes).forEach(p => {
                if (p.wonBy === req.user.uid) winnings.push({ gameId: c.key, prize: p.secret, number: p.number, wonAt: p.wonAt });
            });
        });
        res.json({ winnings });
    } catch (e) { res.status(500).json({ error: "Błąd serwera" }); }
});

// 4. GAME META
app.get('/api/game/:gameId/meta', async (req, res) => {
    const snap = await db.ref(`games/${req.params.gameId}/config`).once('value');
    if (!snap.exists()) return res.status(404).json({ error: "Brak gry" });
    res.json({ config: snap.val() });
});

// 5. MY RESULT
app.post('/api/game/:gameId/my-result', verifyTokenOptional, async (req, res) => {
    const { gameId, userData } = req.body;
    let playerId = null;

    if (req.user) playerId = req.user.uid;
    else if (userData?.email) playerId = sanitizeKey(userData.email); // ✅ FIX: Sanityzacja
    else if (userData?.name) playerId = sanitizeKey(userData.name);   // ✅ FIX: Sanityzacja

    if (!playerId) return res.json({ hasPlayed: false });

    const snap = await db.ref(`games/${gameId}/prizes`).once('value');
    let myPrize = null;
    if(snap.exists()) snap.forEach(p => { if(p.val().wonBy === playerId) myPrize = p.val(); });
    res.json({ hasPlayed: !!myPrize, prize: myPrize });
});

// 6. ADMIN DETAILS
app.get('/api/game/:gameId/admin-details', verifyTokenOptional, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Zaloguj się" });
    const snap = await db.ref(`games/${req.params.gameId}`).once('value');
    if(!snap.exists()) return res.status(404).json({error: "Brak gry"});
    if(snap.val().adminUid !== req.user.uid) return res.status(403).json({error: "Brak dostępu"});
    const g = snap.val();
    res.json({ 
        config: g.config, 
        prizes: g.prizes ? Object.values(g.prizes) : [], 
        audit: g.audit ? Object.values(g.audit).sort((a,b)=>b.timestamp-a.timestamp) : [] 
    });
});

// 7. SPIN - ✅ FIX BŁĘDU 500
app.post('/api/spin', verifyTokenOptional, async (req, res) => {
    const { gameId, userData } = req.body;
    if (!gameId) return res.status(400).json({ error: "Brak ID" });

    try {
        const gameRef = db.ref(`games/${gameId}`);
        const snap = await gameRef.once('value');
        if (!snap.exists()) return res.status(404).json({ error: "Nie znaleziono gry" });

        const game = snap.val();
        const config = game.config;
        
        let playerId = null;
        let playerName = "Anonim";
        let playerEmail = "-";

        // A. Identyfikacja
        if (req.user) {
            playerId = req.user.uid;
            playerName = req.user.name || req.user.email || "Gość";
            playerEmail = req.user.email || "-";
        } else {
            if (config.authType === 'google') return res.status(401).json({ error: "Wymagane logowanie" });
            
            if (config.authType === 'email') {
                if (!userData?.email) return res.status(400).json({ error: "Podaj email" });
                playerId = sanitizeKey(userData.email); // ✅ FIX
                playerName = userData.email;
                playerEmail = userData.email;
            } else {
                if (!userData?.name) return res.status(400).json({ error: "Podaj imię" });
                playerId = sanitizeKey(userData.name);  // ✅ FIX
                playerName = userData.name;
            }
        }

        // Nadpisanie jeśli dane są w formularzu
        if (userData?.name) playerName = userData.name;
        if (userData?.email) playerEmail = userData.email;

        // B. Sprawdzenie limitu
        const userHistory = game.users?.[playerId] || { spinsUsed: 0 };
        if (userHistory.spinsUsed >= config.spinLimit) {
            await logAudit(gameId, "SPIN_BLOCKED", `Limit: ${playerName}`, { playerId });
            
            // Pobieramy starą nagrodę
            const all = game.prizes ? Object.values(game.prizes) : [];
            const old = all.find(p => p.wonBy === playerId);
            
            return res.status(403).json({ 
                error: "Limit wykorzystany", 
                code: "LIMIT_REACHED",
                oldPrize: old ? { secret: old.secret, number: old.number } : null
            });
        }

        // C. Losowanie
        const allPrizes = game.prizes ? Object.entries(game.prizes).map(([k, v]) => ({...v, id: k})) : [];
        const available = allPrizes.filter(p => !p.wonBy);
        if (available.length === 0) return res.status(404).json({ error: "Brak nagród", code: "NO_PRIZES" });

        const winnerPrize = available[Math.floor(Math.random() * available.length)];

        // D. Zapis
        const updates = {};
        updates[`games/${gameId}/prizes/${winnerPrize.id}/wonBy`] = playerId;
        updates[`games/${gameId}/prizes/${winnerPrize.id}/wonByName`] = playerName;
        updates[`games/${gameId}/prizes/${winnerPrize.id}/wonByEmail`] = playerEmail;
        updates[`games/${gameId}/prizes/${winnerPrize.id}/wonAt`] = Date.now();
        updates[`games/${gameId}/users/${playerId}/spinsUsed`] = userHistory.spinsUsed + 1;
        
        updates[`games/${gameId}/gameState`] = {
            spinning: true,
            spinnerName: playerName,
            prizeId: winnerPrize.id,
            timestamp: Date.now()
        };

        await db.ref().update(updates);
        await logAudit(gameId, "SPIN_SUCCESS", `${playerName} wygrał: ${winnerPrize.number}`, { prize: winnerPrize.secret });

        setTimeout(() => { db.ref(`games/${gameId}/gameState`).update({ spinning: false }); }, 5000);

        res.json({ success: true, number: winnerPrize.number, secretPrize: winnerPrize.secret });

    } catch (e) {
        console.error("SERVER ERROR:", e);
        res.status(500).json({ error: "Błąd serwera. Spróbuj ponownie." });
    }
});

// 8. DELETE
app.delete('/api/game/:gameId', verifyTokenOptional, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Brak uprawnień" });
    const snap = await db.ref(`games/${req.params.gameId}`).once('value');
    if (!snap.exists() || snap.val().adminUid !== req.user.uid) return res.status(403).json({ error: "Błąd" });
    await db.ref(`games/${req.params.gameId}`).remove();
    res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API running on ${PORT}`));