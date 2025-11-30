# 🎡 Wheel SaaS - Secure Raffle Platform

A professional, full-stack SaaS platform for creating and managing secure "Spin the Wheel" games. Designed for corporate events, team integrations, and giveaways where fairness and data integrity are paramount.

**Current Version:** 1.1.0 (Stable)
**Built by:** [LigeroIT](https://github.com/ligeroIT)

---

## 🚀 Key Features

### 🛡️ Security & Fairness
* **Client-Server Architecture:** All logic (RNG, prize selection) runs on a secure Node.js backend. The frontend only displays the result.
* **"Secret Santa" Logic:** The system automatically prevents a player from drawing a prize that matches their own name.
* **Anti-Cheat:** Server-side validation of spin limits per user.
* **Audit Logs:** Every action (creation, spin, error) is logged in the database with timestamps and user details.

### 🎨 User Experience
* **CSS-Based Animation:** Smooth, high-performance wheel rotation using hardware-accelerated CSS transitions (replaced legacy JS libraries).
* **Color Themes:** Organizers can choose from 7 presets (Vibrant, Corporate, Gold, Neon, etc.).
* **Confetti Effect:** Celebratory animation upon winning.
* **Smart "Game Over":** The wheel automatically hides when all prizes have been distributed.

### 🔐 Authentication
* **Hybrid Login:** Supports Google, Facebook, and Email-based identification.
* **Guest Mode:** Anonymous login support allows guests to play without creating an account (while maintaining security rules).
* **Persistent Session:** Remembers guest details so they don't have to re-enter them upon refreshing.

### 📊 Dashboard
* **Organizer View:** Manage created games, view audit logs, and copy invite links.
* **Player View:** See history of personal winnings across different games.

---

## 🛠 Tech Stack

* **Frontend:** HTML5, CSS3, Vanilla JavaScript (Canvas API + CSS Transforms).
* **Backend:** Node.js, Express.js.
* **Database:** Firebase Realtime Database.
* **Authentication:** Firebase Auth (Google, Facebook, Anonymous).
* **Hosting:** GitHub Pages (Frontend) + Render.com (Backend).

---

## ⚙️ Installation & Setup

### 1. Prerequisites
* A Firebase Project (Blaze plan recommended, but works on Spark).
* Node.js installed locally (for development).

### 2. Backend Setup
The backend handles the logic and connects to Firebase with Admin privileges.

1.  Navigate to `server.js` directory.
2.  Install dependencies:
    ```bash
    npm install express cors firebase-admin uuid
    ```
3.  Set up Environment Variables (e.g., in `.env` or Render Dashboard):
    * `FIREBASE_DB_URL`: Your Firebase Database URL.
    * `FIREBASE_SERVICE_ACCOUNT`: The content of your Firebase Admin JSON key.
4.  Start the server:
    ```bash
    node server.js
    ```

### 3. Frontend Setup
The frontend is a static site.

1.  Create a `config.js` file in the root directory:
    ```javascript
    export const firebaseConfig = {
        apiKey: "YOUR_API_KEY",
        authDomain: "YOUR_PROJECT.firebaseapp.com",
        databaseURL: "YOUR_DB_URL",
        projectId: "YOUR_PROJECT_ID",
        storageBucket: "YOUR_PROJECT.appspot.com",
        messagingSenderId: "SENDER_ID",
        appId: "APP_ID"
    };

    export const API_URL = "[https://your-backend-url.onrender.com](https://your-backend-url.onrender.com)";
    export const APP_VERSION = "1.1.0";
    ```
2.  Serve `index.html` using any static server (e.g., Live Server, GitHub Pages).

---

## 📖 Usage Guide

### Creating a Game
1.  Log in as an Administrator.
2.  Click **"Create New Game"**.
3.  Set the **Game Title**, **Auth Type** (Name/Email/Google), and **Color Theme**.
4.  Add prizes (Visible numbers vs. Hidden secrets).
5.  Share the generated **Game Code** or **Link**.

### Playing
1.  Enter the Game Code.
2.  Enter your details or log in.
3.  Click **SPIN**.
4.  If you win, the secret prize is revealed!

---

## 📄 Legal & License

* **License:** MIT License.
* **Privacy Policy:** Included in `privacy.html`.
* **Terms of Service:** Included in `terms.html`.

Copyright © 2025 **LigeroIT**.
