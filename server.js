const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const app = express();

app.use(cors());
app.use(express.json());

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

async function logAudit(gameId, action, description, meta = {}) {
    try {
        await db.ref(`games/${gameId}/audit`).push({ action, description, meta, timestamp: Date.now() });
    } catch (e) { console.error("Audit Error", e); }
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

// 1. TWORZENIE GRY
app.post('/api/create-game', verifyTokenOptional, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Zaloguj się, aby stworzyć grę." });
    
    const { config, prizes } = req.body; 
    let gameId = null, isUnique = false, attempts = 0;

    while (!isUnique && attempts < 10) {
        gameId = generateRandomId(6);
        const snap = await db.ref(`games/${gameId}`).once('value');
        if (!snap.exists()) isUnique = true;
        attempts++;
    }
    if (!isUnique) return res.status(500).json({ error: "Błąd serwera." });

    await db.ref(`games/${gameId}`).set({
        adminUid: req.user.uid,
        config: config,
        prizes: prizes,
        createdAt: Date.now()
    });
    await logAudit(gameId, "GAME_CREATED", `Gra utworzona przez ${req.user.email || req.user.name}`);
    res.json({ success: true, gameId });
});

// 2. ADMIN: GRY KTÓRE STWORZYŁEM
app.get('/api/my-created-games', verifyTokenOptional, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Musisz być zalogowany." });
    try {
        const ref = db.ref('games');
        const snapshot = await ref.orderByChild('adminUid').equalTo(req.user.uid).once('value');
        const games = [];
        snapshot.forEach(child => {
            const val = child.val();
            games.push({
                id: child.key,
                createdAt: val.createdAt,
                prizesCount: val.prizes ? Object.keys(val.prizes).length : 0
            });
        });
        games.sort((a, b) => b.createdAt - a.createdAt);
        res.json({ games });
    } catch (e) { res.status(500).json({ error: "Błąd serwera." }); }
});

// 3. USER: GRY W KTÓRYCH WYGRAŁEM (Nowość!)
app.get('/api/my-winnings', verifyTokenOptional, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Zaloguj się, aby zobaczyć swoje wygrane." });
    
    try {
        // Firebase RTDB nie ma zaawansowanych zapytań SQL, więc musimy pobrać gry i przefiltrować
        // W dużej skali to trzeba by zoptymalizować (indeksy po wonBy), ale dla MVP wystarczy.
        // Optymalizacja: Pobieramy tylko gry, gdzie występuje nasz UID (to wymagałoby innej struktury).
        // Tutaj zrobimy "brute force" po najnowszych grach, albo po prostu sprawdzimy kilka ostatnich.
        // DLA MVP: Sprawdzamy wszystkie gry (uwaga na wydajność w przyszłości!)
        
        const snapshot = await db.ref('games').limitToLast(100).once('value'); // Ostatnie 100 gier
        const winnings = [];

        snapshot.forEach(child => {
            const game = child.val();
            const gameId = child.key;
            if (game.prizes) {
                Object.values(game.prizes).forEach(prize => {
                    if (prize.wonBy === req.user.uid) {
                        winnings.push({
                            gameId: gameId,
                            prize: prize.secret,
                            number: prize.number,
                            wonAt: prize.wonAt
                        });
                    }
                });
            }
        });
        winnings.sort((a, b) => b.wonAt - a.wonAt);
        res.json({ winnings });
    } catch (e) { res.status(500).json({ error: "Błąd serwera." }); }
});

// 4. META DANE GRY
app.get('/api/game/:gameId/meta', async (req, res) => {
    const { gameId } = req.params;
    const snap = await db.ref(`games/${gameId}/config`).once('value');
    if (!snap.exists()) return res.status(404).json({ error: "Gra nie istnieje." });
    res.json({ config: snap.val() });
});

// 5. SPRAWDŹ CZY JUŻ GRAŁEM (W KONKRETNEJ GRZE)
app.post('/api/game/:gameId/my-result', verifyTokenOptional, async (req, res) => {
    const { gameId, userData } = req.body;
    let playerId = null;

    if (req.user) {
        playerId = req.user.uid; // Priorytet: Zalogowany User
    } else if (userData?.email) {
        playerId = userData.email.replace(/[.#$/[\]]/g, '_');
    } else if (userData?.name) {
        playerId = userData.name.toLowerCase().trim();
    }

    if (!playerId) return res.json({ hasPlayed: false });

    const prizesSnap = await db.ref(`games/${gameId}/prizes`).once('value');
    let myPrize = null;
    if(prizesSnap.exists()) {
        prizesSnap.forEach(p => {
            if(p.val().wonBy === playerId) myPrize = p.val();
        });
    }
    res.json({ hasPlayed: !!myPrize, prize: myPrize });
});

// 6. DETALE DLA ADMINA (AUDYT)
app.get('/api/game/:gameId/admin-details', verifyTokenOptional, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Zaloguj się" });
    const { gameId } = req.params;
    const gameSnap = await db.ref(`games/${gameId}`).once('value');
    if(!gameSnap.exists()) return res.status(404).json({error: "Brak gry"});
    const game = gameSnap.val();
    if(game.adminUid !== req.user.uid) return res.status(403).json({error: "Brak dostępu"});

    res.json({
        config: game.config,
        prizes: game.prizes ? Object.values(game.prizes) : [],
        audit: game.audit ? Object.values(game.audit).sort((a,b) => b.timestamp - a.timestamp) : []
    });
});

// 7. SPIN
app.post('/api/spin', verifyTokenOptional, async (req, res) => {
    const { gameId, userData } = req.body;
    if (!gameId) return res.status(400).json({ error: "Brak ID" });

    try {
        const gameRef = db.ref(`games/${gameId}`);
        const gameSnap = await gameRef.once('value');
        if (!gameSnap.exists()) return res.status(404).json({ error: "Gra nie istnieje" });

        const game = gameSnap.val();
        const config = game.config;
        
        let playerId = null;
        let playerName = "Anonim";

        // LOGIKA HYBRYDOWA:
        // Jeśli user jest zalogowany (Google/FB) -> używamy UID (najsilniejsze)
        // Jeśli nie jest, ale podał dane w formularzu -> używamy danych z formularza
        
        if (req.user) {
            playerId = req.user.uid;
            playerName = req.user.name || req.user.email || "Zalogowany Gracz";
        } else {
            // Niezalogowany: Sprawdzamy wymogi gry
            if (config.authType === 'google' || config.authType === 'facebook') { // 'facebook' to alias dla 'google' w starej konfiguracji, ale obsłużymy to
                 return res.status(401).json({ error: "Musisz się zalogować!" });
            }
            
            if (config.authType === 'email') {
                if (!userData?.email) return res.status(400).json({ error: "Podaj email" });
                playerId = userData.email.replace(/[.#$/[\]]/g, '_');
                playerName = userData.email;
            } else {
                if (!userData?.name) return res.status(400).json({ error: "Podaj imię" });
                playerId = userData.name.toLowerCase().trim();
                playerName = userData.name;
            }
        }

        const userHistory = game.users?.[playerId] || { spinsUsed: 0 };
        if (userHistory.spinsUsed >= config.spinLimit) {
            await logAudit(gameId, "SPIN_BLOCKED", `Gracz ${playerName} zablokowany (limit)`, { playerId });
            return res.status(403).json({ error: "Limit wykorzystany!", code: "LIMIT_REACHED" });
        }

        const allPrizes = game.prizes ? Object.entries(game.prizes).map(([k, v]) => ({...v, id: k})) : [];
        const available = allPrizes.filter(p => !p.wonBy);

        if (available.length === 0) return res.status(404).json({ error: "Brak nagród!", code: "NO_PRIZES" });

        const winnerPrize = available[Math.floor(Math.random() * available.length)];

        const updates = {};
        updates[`games/${gameId}/prizes/${winnerPrize.id}/wonBy`] = playerId;
        updates[`games/${gameId}/prizes/${winnerPrize.id}/wonByName`] = playerName;
        updates[`games/${gameId}/prizes/${winnerPrize.id}/wonAt`] = Date.now();
        updates[`games/${gameId}/users/${playerId}/spinsUsed`] = userHistory.spinsUsed + 1;
        updates[`games/${gameId}/gameState`] = {
            spinning: true,
            spinnerName: playerName,
            prizeId: winnerPrize.id,
            timestamp: Date.now()
        };

        await db.ref().update(updates);
        await logAudit(gameId, "SPIN_SUCCESS", `${playerName} wygrał: ${winnerPrize.number}`, { prizeSecret: winnerPrize.secret });

        setTimeout(() => { db.ref(`games/${gameId}/gameState`).update({ spinning: false }); }, 5000);

        res.json({ success: true, number: winnerPrize.number, secretPrize: winnerPrize.secret });

    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Błąd serwera" });
    }
});

// 8. DELETE
app.delete('/api/game/:gameId', verifyTokenOptional, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Brak autoryzacji" });
    const { gameId } = req.params;
    const gameRef = db.ref(`games/${gameId}`);
    const snap = await gameRef.once('value');
    if (!snap.exists() || snap.val().adminUid !== req.user.uid) return res.status(403).json({ error: "Błąd" });
    await gameRef.remove();
    res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API running on ${PORT}`));