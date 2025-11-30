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

    res.json({ success: true, gameId });
});

// 2. NOWOŚĆ: MOJE GRY (Dla Dashboardu Admina)
app.get('/api/my-games', verifyTokenOptional, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Musisz być zalogowany." });

    try {
        // Pobieramy gry, gdzie adminUid == uid użytkownika
        const ref = db.ref('games');
        const snapshot = await ref.orderByChild('adminUid').equalTo(req.user.uid).once('value');
        
        const games = [];
        snapshot.forEach(child => {
            const val = child.val();
            // Zwracamy tylko podstawowe dane, bez sekretów!
            games.push({
                id: child.key,
                createdAt: val.createdAt,
                prizesCount: val.prizes ? Object.keys(val.prizes).length : 0
            });
        });

        // Sortowanie od najnowszych
        games.sort((a, b) => b.createdAt - a.createdAt);

        res.json({ games });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Błąd pobierania gier." });
    }
});

// 3. META DANE GRY
app.get('/api/game/:gameId/meta', async (req, res) => {
    const { gameId } = req.params;
    const snap = await db.ref(`games/${gameId}/config`).once('value');
    if (!snap.exists()) return res.status(404).json({ error: "Taka gra nie istnieje." });
    res.json({ config: snap.val() });
});

// 4. LOSOWANIE (SPIN)
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

        // Logika Auth
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
            // Tworzymy ID z imienia (uproszczone, by blokować ponowne losowanie na to samo imię)
            playerId = userData.name.toLowerCase().trim();
            playerName = userData.name;
        }

        // SPRAWDZENIE LIMITÓW
        const userHistory = game.users?.[playerId] || { spinsUsed: 0 };
        if (userHistory.spinsUsed >= config.spinLimit) {
            // Zwracamy specjalny kod błędu 'LIMIT_REACHED' dla frontendu
            return res.status(403).json({ error: "Wykorzystałeś już swój limit losowań!", code: "LIMIT_REACHED" });
        }

        const allPrizes = game.prizes ? Object.entries(game.prizes).map(([k, v]) => ({...v, id: k})) : [];
        const available = allPrizes.filter(p => !p.wonBy);

        if (available.length === 0) return res.status(404).json({ error: "Wszystkie nagrody zostały rozdane!", code: "NO_PRIZES" });

        const winnerPrize = available[Math.floor(Math.random() * available.length)];

        const updates = {};
        updates[`games/${gameId}/prizes/${winnerPrize.id}/wonBy`] = playerId;
        updates[`games/${gameId}/users/${playerId}/spinsUsed`] = userHistory.spinsUsed + 1;
        updates[`games/${gameId}/gameState`] = {
            spinning: true,
            spinnerName: playerName,
            prizeId: winnerPrize.id,
            timestamp: Date.now()
        };

        await db.ref().update(updates);

        setTimeout(() => { db.ref(`games/${gameId}/gameState`).update({ spinning: false }); }, 5000);

        res.json({
            success: true,
            number: winnerPrize.number,
            secretPrize: winnerPrize.secret
        });

    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Błąd serwera" });
    }
});

// 5. USUWANIE GRY (DELETE)
app.delete('/api/game/:gameId', verifyTokenOptional, async (req, res) => {
    // 1. Sprawdź czy user jest zalogowany
    if (!req.user) return res.status(401).json({ error: "Musisz być zalogowany." });

    const { gameId } = req.params;

    try {
        const gameRef = db.ref(`games/${gameId}`);
        const snapshot = await gameRef.once('value');

        if (!snapshot.exists()) {
            return res.status(404).json({ error: "Gra nie istnieje." });
        }

        const game = snapshot.val();

        // 2. Sprawdź czy to Twój pokój (Security Check)
        if (game.adminUid !== req.user.uid) {
            return res.status(403).json({ error: "Nie masz uprawnień do usunięcia tej gry!" });
        }

        // 3. Usuń
        await gameRef.remove();

        res.json({ success: true });

    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Błąd serwera." });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Backend działa na porcie ${PORT}`));