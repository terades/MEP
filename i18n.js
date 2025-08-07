// i18n.js

let translations = {};
// Die aktuelle Sprache wird aus dem localStorage geladen oder auf 'de' als Standard gesetzt.
// Dies ist wichtig für den Initialzustand und falls keine Sprache explizit gesetzt wurde.
let currentLang = localStorage.getItem("language") || "de"; 

/**
 * Helferfunktion zum Abrufen von Übersetzungen im JavaScript-Code.
 * Diese Funktion ist global über `window.i18n.t()` zugänglich.
 * Sie ermöglicht das Übersetzen von Texten, die nicht direkt im HTML mit `data-i18n`
 * Attributen versehen werden können (z.B. Texte, die dynamisch generiert werden oder
 * in alert()-Boxen erscheinen).
 *
 * @param {string} key - Der Schlüssel des zu übersetzenden Textes, der in den JSON-Sprachdateien definiert ist.
 * @param {Object} [replacements={}] - Ein optionales Objekt, das Platzhalter und deren Werte enthält.
 * Beispiel: `{ name: "Max", age: 30 }` für einen Text wie "Hello {name}, you are {age} years old."
 * @returns {string} Der übersetzte Text mit ersetzten Platzhaltern oder der Originalschlüssel,
 * wenn keine Übersetzung gefunden wurde (um leere Stellen zu vermeiden).
 */
window.i18n = {
    t: function(key, replacements = {}) {
        let translatedText = key; // Standardmäßig ist der übersetzte Text der Schlüssel selbst

        // Versuche, die Übersetzung in der aktuell geladenen Sprachdatei zu finden.
        if (translations[key]) {
            translatedText = translations[key];
        } else {
            // Wenn der Schlüssel in der aktuellen Übersetzung nicht gefunden wird,
            // kann eine Warnung in der Konsole ausgegeben werden.
            // Dies ist nützlich für das Debugging fehlender Übersetzungen.
            // console.warn(`Übersetzung fehlt für Schlüssel: "${key}" in Sprache "${currentLang}". Fallback auf Originalschlüssel.`);
        }

        // Iteriere über das `replacements`-Objekt, um alle Platzhalter im übersetzten Text zu ersetzen.
        // Ein Platzhalter im Text wird durch `{placeholderName}` dargestellt.
        for (const placeholder in replacements) {
            // Stelle sicher, dass die Eigenschaft direkt zum `replacements`-Objekt gehört
            // und nicht aus der Prototypenkette geerbt wurde.
            if (Object.prototype.hasOwnProperty.call(replacements, placeholder)) {
                // Erstelle einen regulären Ausdruck, um den Platzhalter zu finden.
                // Das 'g'-Flag (global) stellt sicher, dass alle Vorkommen des Platzhalters ersetzt werden.
                const regex = new RegExp(`{${placeholder}}`, 'g');
                // Ersetze den Platzhalter im Text durch den entsprechenden Wert aus `replacements`.
                translatedText = translatedText.replace(regex, replacements[placeholder]);
            }
        }

        return translatedText; // Gib den finalen, übersetzten Text zurück.
    }
};

/**
 * Lädt die Sprachdatei als JSON aus dem 'lang/' Verzeichnis und aktualisiert die aktive Sprache.
 * Nach dem erfolgreichen Laden werden alle textuellen Elemente auf der Seite übersetzt
 * und dynamische UI-Elemente aktualisiert.
 *
 * @param {string} lang - Der Sprachcode (z.B. 'de', 'en', 'pl', 'cz').
 */
async function loadLanguage(lang) {
    try {
        // Versuche, die JSON-Datei für die angegebene Sprache zu laden.
        const response = await fetch(`lang/${lang}.json`);

        // Überprüfe, ob die Anfrage erfolgreich war (HTTP-Status 200-299).
        if (!response.ok) {
            // Wenn ein Fehler auftritt (z.B. 404 Not Found), wirf einen Fehler.
            throw new Error(`Fehler beim Laden der Sprachdatei "${lang}.json": ${response.statusText}`);
        }

        // Parse die JSON-Antwort in das `translations`-Objekt.
        translations = await response.json();
        currentLang = lang; // Aktualisiere die globalen `currentLang`.
        localStorage.setItem("language", lang); // Speichere die gewählte Sprache im localStorage.

        // Wende die Übersetzungen auf alle statischen HTML-Elemente an.
        applyTranslations();

        // Aktualisiere das Sprachauswahl-Dropdown, um die aktuell ausgewählte Sprache anzuzeigen.
        const select = document.getElementById("languageSelect");
        if (select) {
            select.value = lang;
        }

        // !!! WICHTIG !!!
        // Nach dem Laden einer neuen Sprache müssen alle Funktionen, die dynamische
        // Textelemente in den Skripten rendern, erneut aufgerufen werden.
        // Dies stellt sicher, dass alle dynamisch generierten UI-Elemente
        // die neue Sprache übernehmen.
        // Die Funktionen müssen global verfügbar sein (z.B. nicht in einem lokalen Scope).
        if (typeof updateBarcodeStatus === 'function') updateBarcodeStatus();
        if (typeof renderAllZones === 'function') renderAllZones();
        if (typeof drawCagePreview === 'function') drawCagePreview(); // Enthält die SVG-Texte mit Platzhaltern
        if (typeof updateLabelPreview === 'function') updateLabelPreview();
        if (typeof renderProductionList === 'function') renderProductionList();
        // Fügen Sie hier alle weiteren Funktionen aus den Skripten hinzu,
        // die UI-Elemente mit Text aktualisieren.

    } catch (error) {
        console.error("Schwerwiegender Fehler beim Laden oder Anwenden der Sprachdatei:", error);
        // Optional: Zeigen Sie eine Fehlermeldung auf der UI an, falls das Laden fehlschlägt.
    }
}

/**
 * Übersetzt alle statischen HTML-Elemente auf der Seite, die mit `data-i18n`,
 * `data-i18n-placeholder` oder `data-i18n-title` Attributen versehen sind.
 * Diese Funktion wird nach dem Laden einer Sprachdatei aufgerufen.
 */
function applyTranslations() {
    // Übersetze Textinhalte von Elementen (z.B. <p>, <span>, <h1>, <button>).
    document.querySelectorAll("[data-i18n]").forEach(el => {
        const key = el.getAttribute("data-i18n");
        if (translations[key]) {
            el.textContent = translations[key];
        } else {
            // Belasse den HTML-Inhalt, wenn keine Übersetzung gefunden wird.
            // Dies dient als Fallback und verhindert leere Texte.
            // console.warn(`applyTranslations: Übersetzung fehlt für Schlüssel: "${key}" in Sprache "${currentLang}". HTML-Standardtext wird verwendet.`);
        }
    });

    // Übersetze Placeholder-Texte für Input-Felder.
    document.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
        const key = el.getAttribute("data-i18n-placeholder");
        if (translations[key]) {
            el.placeholder = translations[key];
        } else {
            // console.warn(`applyTranslations: Übersetzung fehlt für Placeholder-Schlüssel: "${key}" in Sprache "${currentLang}". Original-Placeholder wird verwendet.`);
        }
    });

    // Übersetze Tooltip-Texte (title-Attribute).
    document.querySelectorAll("[data-i18n-title]").forEach(el => {
        const key = el.getAttribute("data-i18n-title");
        if (translations[key]) {
            el.title = translations[key];
        } else {
            // console.warn(`applyTranslations: Übersetzung fehlt für Title-Schlüssel: "${key}" in Sprache "${currentLang}". Original-Title wird verwendet.`);
        }
    });
}

/**
 * Diese Funktion wird aufgerufen, wenn der Benutzer die Sprache über das Dropdown ändert.
 * Sie löst das Neuladen der entsprechenden Sprachdatei aus.
 * @param {string} lang - Der Sprachcode ('de', 'en', 'pl', 'cz').
 */
function setLanguage(lang) {
    loadLanguage(lang);
}

// Initialisierung der Sprachlogik beim vollständigen Laden des DOM.
// Dies stellt sicher, dass alle HTML-Elemente vorhanden sind, bevor Übersetzungen angewendet werden.
document.addEventListener("DOMContentLoaded", () => {
    // Versuche, die zuletzt gewählte Sprache aus dem localStorage zu laden.
    // Wenn keine Sprache gespeichert ist, verwende Deutsch ('de') als Standard.
    const lang = localStorage.getItem("language") || "de";
    loadLanguage(lang); // Lade die entsprechende Sprachdatei.

    // Dies ist ein spezieller Fall, falls das placeholder-Attribut nicht direkt
    // über data-i18n-placeholder im HTML gesetzt ist oder dynamisch initialisiert werden muss.
    // Falls Sie data-i18n-placeholder im HTML verwenden, können Sie diese Zeilen entfernen,
    // da applyTranslations dies bereits abdeckt.
    const templateNameInput = document.getElementById('templateName');
    if (templateNameInput) {
        // Die i18n.t-Funktion sollte zu diesem Zeitpunkt bereits global definiert sein,
        // da die Skripte nach i18n.js geladen werden und i18n.js window.i18n.t direkt definiert.
        templateNameInput.placeholder = i18n.t('Neuer Template-Name...');
    }
});
