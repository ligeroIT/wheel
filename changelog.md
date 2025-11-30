# Changelog

All notable changes to the "Wheel SaaS" project will be documented in this file.

## [1.1.0] - 2025-11-30 (Stable Release - Secret Santa)
### Added
- **"Secret Santa" Logic:** The backend now checks if the prize content matches the player's name. If so, the prize is skipped during the draw (preventing self-selection).
- **Special Character Protection:** Added `sanitizeKey` function in the backend to remove dots and special characters from player IDs (fixing 500 error when entering "Jan.Kowalski").
- **Default Email Values:** The backend now inserts a dash `"-"` if the player did not provide an email (fixing `undefined` error).

### Changed
- Updated `POST /api/spin` logic to save the `wonByEmail` field in the database.

---

## [1.0.5] - 2025-11-30 (UX Update)
### Added
- **Color Themes:** Added ability to select color palettes when creating a game (Vibrant, Corporate, Gold, Neon, etc.).
- **Rich Success Modal:** After creating a game, a window appears with a large code, link copy field, and "open in new tab" button.
- **"Game Over" View:** If there are no prizes left in the pool, the wheel automatically disappears, and an aesthetic game over message appears.
- **Audit Table:** Added "Email" column in the history view for the Administrator.

### Fixed
- Automatic hiding of the wheel when the `activePrizes` list is empty.

---

## [1.0.4] - 2025-11-30 (Guests & Legal)
### Added
- **Anonymous Login:** Implemented `signInAnonymously` with Firebase Auth. Fixes the "white wheel" issue for non-logged-in guests (Security Rules).
- **Legal Documents:** Added `privacy.html` and `terms.html` pages with contact forms.
- **Footer:** Added legal links and version number in the app footer.

---

## [1.0.3] - 2025-11-30 (Social & Dashboard)
### Added
- **Social Login:** Integration with Google and Facebook Auth.
- **User Dashboard:** Split into "Created Games" (for Admin) and "My Winnings" (for Player) tabs.
- **Guest Memory:** Saving data (Name/Email) in `localStorage` so the player doesn't have to re-enter it after refreshing.
- **Prize Reminder:** If a player re-enters the game, they see their winning instead of the wheel.

---

## [1.0.2] - 2025-11-30 (New Animation Engine)
### Changed
- **Removed Winwheel.js:** Replaced old library with pure Canvas code + CSS Transform.
- **Animation:** Smooth wheel rotation using `cubic-bezier`.
- **Confetti:** Added confetti burst effect upon winning.

---

## [1.0.1] - 2025-11-30 (SaaS Architecture)
### Added
- **Backend (Node.js):** Moved draw logic to the server (Render.com). Hiding prizes from the frontend.
- **Room System:** Handling multiple games simultaneously based on `gameId`.
- **Code Generator:** Short game codes (e.g., `X9P2M`).
- **Audit:** Logging all events (creation, spin) in the database.

---

## [1.0.0] - 2025-11-29 (Initialization)
- First static version on GitHub Pages.
- Basic integration with Firebase Realtime Database.
