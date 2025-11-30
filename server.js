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

// Funkcja do zapisywania logów audytowych
async function logAudit(gameId, action, description, meta = {}) {
    const logRef = db.ref(`games/${gameId}/audit`);
    await logRef.push({
        action,       // np. "GAME_CREATED", "SPIN_RESULT"
        description,  // np. "Utworzono grę", "Marek wylosował numer 1"
        meta,         // Dodatkowe dane (np. kto to zrobił)
        timestamp: Date.now()
    });
}

async function verifyTokenOptional(req, res, next) {
    const token = req.headers.authorization?.split('Bearer ')[1];
    if (token) {
        try {
            const decodedToken = await admin.auth().verifyIdToken(token);
            req.user = decodedToken;
        } catch (e) {
            console.log("Token invalid");
        }
    }
    next();
}

// --- ENDPOINTY ---

// 1. TWORZENIE GRY
app.post('/api/create-game', verifyTokenOptional, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Musisz być zalogowany." });
    
    const { config, prizes } = req.body; 
    let gameId = null;
    let isUnique = false;
    let attempts = 0;

    while (!isUnique && attempts < 10) {
        gameId = generateRandomId(6);
        const snap = await db.ref(`games/${gameId}`).once('value');
        if (!snap.exists()) isUnique = true;
        attempts++;
    }

    if (!isUnique) return res.status(500).json({ error: "Błąd serwera. Spróbuj ponownie." });

    await db.ref(`games/${gameId}`).set({
        adminUid: req.user.uid,
        config: config,
        prizes: prizes,
        createdAt: Date.now()
    });

    // LOG AUDYTOWY
    await logAudit(gameId, "GAME_CREATED", `Gra utworzona przez ${req.user.email}`, { adminId: req.user.uid });

    res.json({ success: true, gameId });
});

// 2. MOJE GRY (Lista)
app.get('/api/my-games', verifyTokenOptional, async (req, res) => {
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
    } catch (e) {
        res.status(500).json({ error: "Błąd serwera." });
    }
});

// 3. META DANE GRY
app.get('/api/game/:gameId/meta', async (req, res) => {
    const { gameId } = req.params;
    const snap = await db.ref(`games/${gameId}/config`).once('value');
    if (!snap.exists()) return res.status(404).json({ error: "Gra nie istnieje." });
    res.json({ config: snap.val() });
});

// 4. NOWOŚĆ: SPRAWDŹ MÓJ WYNIK (Dla gracza)
app.post('/api/game/:gameId/my-result', verifyTokenOptional, async (req, res) => {
    const { gameId, userData } = req.body;
    
    // Identyfikacja gracza (taka sama logika jak w SPIN)
    let playerId = null;
    const snapConfig = await db.ref(`games/${gameId}/config`).once('value');
    if(!snapConfig.exists()) return res.status(404).json({error: "Gra nie istnieje"});
    const config = snapConfig.val();

    if (config.authType === 'google') {
        if (!req.user) return res.status(401).json({ error: "Zaloguj się" });
        playerId = req.user.uid;
    } else if (config.authType === 'email') {
        if (!userData?.email) return res.status(400).json({ error: "Email wymagany" });
        playerId = userData.email.replace(/[.#$/[\]]/g, '_');
    } else {
        if (!userData?.name) return res.status(400).json({ error: "Imię wymagane" });
        playerId = userData.name.toLowerCase().trim();
    }

    // Szukamy czy ten gracz coś wygrał
    const prizesSnap = await db.ref(`games/${gameId}/prizes`).once('value');
    let myPrize = null;
    
    if(prizesSnap.exists()) {
        prizesSnap.forEach(p => {
            if(p.val().wonBy === playerId) {
                myPrize = p.val();
            }
        });
    }

    if(myPrize) {
        res.json({ hasPlayed: true, prize: myPrize });
    } else {
        res.json({ hasPlayed: false });
    }
});

// 5. NOWOŚĆ: PEŁNA HISTORIA I AUDYT (Tylko dla Admina tej gry)
app.get('/api/game/:gameId/admin-details', verifyTokenOptional, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Zaloguj się" });
    const { gameId } = req.params;

    const gameSnap = await db.ref(`games/${gameId}`).once('value');
    if(!gameSnap.exists()) return res.status(404).json({error: "Gra nie istnieje"});
    
    const game = gameSnap.val();

    if(game.adminUid !== req.user.uid) return res.status(403).json({error: "Brak dostępu"});

    // Konwersja obiektów na tablice
    const prizes = game.prizes ? Object.values(game.prizes) : [];
    const audit = game.audit ? Object.values(game.audit).sort((a,b) => b.timestamp - a.timestamp) : [];

    res.json({
        config: game.config,
        prizes: prizes,
        audit: audit
    });
});

// 6. LOSOWANIE (SPIN)
app.post('/api/spin', verifyTokenOptional, async (req, res) => {
    const { gameId, userData } = req.body;
    if (!gameId) return res.status(400).json({ error: "Brak ID gry" });

    try {
        const gameRef = db.ref(`games/${gameId}`);
        const gameSnap = await gameRef.once('value');
        if (!gameSnap.exists()) return res.status(404).json({ error: "Gra nie istnieje" });

        const game = gameSnap.val();
        const config = game.config;
        
        let playerId = null;
        let playerName = null;

        if (config.authType === 'google') {
            if (!req.user) return res.status(401).json({ error: "Wymagane logowanie Google." });
            playerId = req.user.uid;
            playerName = req.user.name || req.user.email;
        } else if (config.authType === 'email') {
            if (!userData?.email) return res.status(400).json({ error: "Podaj email" });
            playerId = userData.email.replace(/[.#$/[\]]/g, '_');
            playerName = userData.email;
        } else {
            if (!userData?.name) return res.status(400).json({ error: "Podaj imię" });
            playerId = userData.name.toLowerCase().trim();
            playerName = userData.name;
        }

        const userHistory = game.users?.[playerId] || { spinsUsed: 0 };
        if (userHistory.spinsUsed >= config.spinLimit) {
            // LOG: Próba przekroczenia limitu
            await logAudit(gameId, "SPIN_BLOCKED", `Gracz ${playerName} próbował przekroczyć limit`, { playerId });
            return res.status(403).json({ error: "Limit wykorzystany!", code: "LIMIT_REACHED" });
        }

        const allPrizes = game.prizes ? Object.entries(game.prizes).map(([k, v]) => ({...v, id: k})) : [];
        const available = allPrizes.filter(p => !p.wonBy);

        if (available.length === 0) return res.status(404).json({ error: "Nagrody rozdane!", code: "NO_PRIZES" });

        const winnerPrize = available[Math.floor(Math.random() * available.length)];

        const updates = {};
        updates[`games/${gameId}/prizes/${winnerPrize.id}/wonBy`] = playerId;
        updates[`games/${gameId}/prizes/${winnerPrize.id}/wonByName`] = playerName; // Zapisujemy imię zwycięzcy
        updates[`games/${gameId}/prizes/${winnerPrize.id}/wonAt`] = Date.now(); // Czas wygranej
        updates[`games/${gameId}/users/${playerId}/spinsUsed`] = userHistory.spinsUsed + 1;
        updates[`games/${gameId}/gameState`] = {
            spinning: true,
            spinnerName: playerName,
            prizeId: winnerPrize.id,
            timestamp: Date.now()
        };

        await db.ref().update(updates);

        // LOG: Udane losowanie
        await logAudit(gameId, "SPIN_SUCCESS", `Gracz ${playerName} wylosował nagrodę nr ${winnerPrize.number}`, { 
            prize: winnerPrize.secret, 
            playerId 
        });

        setTimeout(() => { db.ref(`games/${gameId}/gameState`).update({ spinning: false }); }, 5000);

        res.json({ success: true, number: winnerPrize.number, secretPrize: winnerPrize.secret });

    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Błąd serwera" });
    }
});

// 7. DELETE
app.delete('/api/game/:gameId', verifyTokenOptional, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Zaloguj się" });
    const { gameId } = req.params;

    const gameRef = db.ref(`games/${gameId}`);
    const snapshot = await gameRef.once('value');
    if (!snapshot.exists()) return res.status(404).json({ error: "Gra nie istnieje" });

    if (snapshot.val().adminUid !== req.user.uid) return res.status(403).json({ error: "Brak uprawnień" });

    await gameRef.remove();
    res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Backend działa na porcie ${PORT}`));