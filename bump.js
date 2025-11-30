const fs = require('fs');

// 1. Czytamy obecną wersję z package.json (to jest nasze źródło prawdy)
const packageJson = require('./package.json');
const currentVersion = packageJson.version; // np. "1.0.5"

console.log(`ℹ️ Obecna wersja: ${currentVersion}`);

// 2. Podbijamy licznik (Patch version)
const parts = currentVersion.split('.');
parts[2] = parseInt(parts[2]) + 1; // Zwiększamy ostatnią liczbę
const newVersion = parts.join('.');

console.log(`🚀 Nowa wersja: ${newVersion}`);

// 3. Zapisujemy nową wersję do package.json
packageJson.version = newVersion;
fs.writeFileSync('./package.json', JSON.stringify(packageJson, null, 2));

// 4. Aktualizujemy plik config.js (dla Frontendu)
const configPath = './config.js';
let configContent = fs.readFileSync(configPath, 'utf8');

// Szukamy linii z APP_VERSION i podmieniamy ją
// Regex szuka: export const APP_VERSION = "cośtam";
const versionRegex = /export const APP_VERSION = ".*";/;

if (versionRegex.test(configContent)) {
    configContent = configContent.replace(versionRegex, `export const APP_VERSION = "${newVersion}";`);
} else {
    // Jeśli nie ma takiej linii, dodajemy ją na końcu
    configContent += `\nexport const APP_VERSION = "${newVersion}";`;
}

fs.writeFileSync(configPath, configContent);

console.log("✅ Wersja zaktualizowana w package.json i config.js");