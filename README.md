# 🎡 Wheel SaaS - Secure Raffle Platform

A professional SaaS platform for creating and managing secure, real-time "Spin the Wheel" games. Designed for corporate events, giveaways, and team activities where security and fairness are paramount.

**Built with ❤️ by [LigeroIT](https://github.com/ligeroIT)**

---

## 🚀 Key Features

* **SaaS Architecture:** Create multiple independent game rooms. Each game gets a unique, short access code (e.g., `A9X2B`).
* **Client-Server Security:** Unlike simple static pages, the logic runs on a secure Node.js backend. **Prize details are hidden** from the browser and are only revealed to the specific winner.
* **Flexible Authentication:** Administrators can configure game access requirements:
    * **Google Auth:** For high security and unique identity verification.
    * **Email:** For standard verification.
    * **Name Only:** For quick, casual games.
* **Real-time Synchronization:** Powered by Firebase, all participants see the wheel spin simultaneously.
* **Anti-Cheat:** Server-side validation of spin limits per user.

## 🛠 Tech Stack

The project is a monorepo containing both frontend and backend logic:

* **Frontend:** HTML5, CSS3, Vanilla JavaScript, Firebase SDK (deployed on **GitHub Pages**).
* **Backend:** Node.js, Express.js (deployed on **Render.com**).
* **Database:** Firebase Realtime Database.

---

## ⚙️ Installation & Deployment

### Prerequisites
1.  **Firebase Project:** Create a project at [console.firebase.google.com](https://console.firebase.google.com/).
2.  **Render Account:** For hosting the backend API.

### 1. Backend Setup (Render.com)
1.  Deploy this repository to Render as a **Web Service**.
2.  Set the `Build Command` to `yarn install` (or `npm install`).
3.  Set the `Start Command` to `node server.js`.
4.  Add the following **Environment Variables** in Render settings:
    * `FIREBASE_DB_URL`: Your Firebase Realtime Database URL.
    * `FIREBASE_SERVICE_ACCOUNT`: The full content of your Firebase Admin SDK JSON key.

### 2. Frontend Setup (GitHub Pages)
1.  Open `index.html`.
2.  Update the `firebaseConfig` object with your public Firebase credentials.
3.  Update the `API_URL` constant with your deployed Render backend URL.
4.  Enable **GitHub Pages** in repository settings (Source: `main` branch, `/root` folder).

---

## 📖 Usage Guide

### For Organizers (Admins)
1.  Log in using your Google Account.
2.  Click **"Create New Wheel"**.
3.  Configure the rules (Auth type, Spin limits).
4.  Add prizes (Visible label vs. Hidden secret).
5.  Share the generated **Game Code** with participants.

### For Participants
1.  Enter the **Game Code** provided by the organizer.
2.  Authenticate (if required by the room settings).
3.  Click **SPIN** and wait for the result!

---

## 📄 License

This project is open-source and available under the **MIT License**.

Copyright © 2025 **LigeroIT**.
