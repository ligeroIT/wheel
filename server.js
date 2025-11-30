const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const { v4: uuidv4 } = require('uuid');
const app = express();

app.use(cors());
app.use(express.json());

// POBIERAMY KLUCZE Z RENDER.COM
// Upewnij się, że dodałeś te zmienne w panelu Render!
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
const dbUrl = process.env.FIREBASE_DB_URL;

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: dbUrl
});

const db = admin.database();

// --- POMOCNICY ---

// Generuje krótki kod np. "X9P2M" (bez mylących znaków O/0/I/1)
function generateRandomId(length = 6) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// Middleware: Sprawdza token (jeśli user jest zalogowany)
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

// 1. TWORZENIE GRY (Wymaga bycia zalogowanym Adminem)
app.post('/api/create-game', verifyTokenOptional, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Musisz być zalogowany przez Google, by stworzyć grę." });
    
    const { config, prizes } = req.body; 
    
    let gameId = null;
    let isUnique = false;
    let attempts = 0;

    // Szukamy wolnego ID
    while (!isUnique && attempts < 10) {
        gameId = generateRandomId(6);
        const snap = await db.ref(`games/${gameId}`).once('value');
        if (!snap.exists()) isUnique = true;
        attempts++;
    }

    if (!isUnique) return res.status(500).json({ error: "Błąd serwera (ID collision). Spróbuj ponownie." });

    // Zapisujemy nową grę
    await db.ref(`games/${gameId}`).set({
        adminUid: req.user.uid, // Ten kto założył jest Adminem TEGO pokoju
        config: config,
        prizes: prizes,
        createdAt: Date.now()
    });

    res.json({ success: true, gameId });
});

// 2. META DANE GRY (Publiczne - żeby frontend wiedział czy pokazać input imienia czy login Google)
app.get('/api/game/:gameId/meta', async (req, res) => {
    const { gameId } = req.params;
    const snap = await db.ref(`games/${gameId}/config`).once('value');
    
    if (!snap.exists()) return res.status(404).json({ error: "Taka gra nie istnieje." });
    
    res.json({ config: snap.val() });
});

// 3. LOSOWANIE (SPIN)
app.post('/api/spin', verifyTokenOptional, async (req, res) => {
    const { gameId, userData } = req.body; // userData to { name: "..." } lub { email: "..." }

    if (!gameId) return res.status(400).json({ error: "Brak ID gry" });

    try {
        const gameRef = db.ref(`games/${gameId}`);
        const gameSnap = await gameRef.once('value');
        if (!gameSnap.exists()) return res.status(404).json({ error: "Gra nie istnieje" });

        const game = gameSnap.val();
        const config = game.config;
        
        // A. Weryfikacja tożsamości gracza
        let playerId = null;
        let playerName = null;

        if (config.authType === 'google') {
            if (!req.user) return res.status(401).json({ error: "W tym pokoju wymagane jest logowanie Google." });
            playerId = req.user.uid;
            playerName = req.user.name || req.user.email;
        } else if (config.authType === 'email') {
            if (!userData?.email) return res.status(400).json({ error: "Podaj email" });
            playerId = userData.email.replace(/[.#$/[\]]/g, '_'); // Firebase nie lubi kropek w kluczach
            playerName = userData.email;
        } else {
            // 'name' - najprostsza opcja
            if (!userData?.name) return res.status(400).json({ error: "Podaj imię" });
            playerId = userData.name.toLowerCase().trim() + "_" + Date.now(); // Dodajemy timestamp dla unikalności
            playerName = userData.name;
        }

        // B. Sprawdzenie limitów (ile razy ten playerId już grał)
        const userHistory = game.users?.[playerId] || { spinsUsed: 0 };
        if (userHistory.spinsUsed >= config.spinLimit) {
            return res.status(403).json({ error: "Wykorzystałeś już swój limit losowań!" });
        }

        // C. Losowanie nagrody
        const allPrizes = game.prizes ? Object.entries(game.prizes).map(([k, v]) => ({...v, id: k})) : [];
        const available = allPrizes.filter(p => !p.wonBy);

        if (available.length === 0) return res.status(404).json({ error: "Wszystkie nagrody zostały rozdane!" });

        const winnerPrize = available[Math.floor(Math.random() * available.length)];

        // D. Zapisz wynik (Atomowo)
        const updates = {};
        updates[`games/${gameId}/prizes/${winnerPrize.id}/wonBy`] = playerId;
        updates[`games/${gameId}/users/${playerId}/spinsUsed`] = userHistory.spinsUsed + 1;
        // Uruchom animację
        updates[`games/${gameId}/gameState`] = {
            spinning: true,
            spinnerName: playerName,
            prizeId: winnerPrize.id,
            timestamp: Date.now()
        };

        await db.ref().update(updates);

        // Wyłącz animację po 5s
        setTimeout(() => { db.ref(`games/${gameId}/gameState`).update({ spinning: false }); }, 5000);

        // E. Zwróć SECRET (Tylko zwycięzca to zobaczy)
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Backend działa na porcie ${PORT}`));
