# Sicherheit

## Lücken melden

Sicherheitsprobleme bitte **nicht** über einen öffentlichen Issue, sondern an
**martin.pfeffer@celox.io**. Hilfreich sind: betroffene Version (Badge im
README), ein möglichst kleiner Reproduktionsweg und die erwartete gegenüber der
beobachteten Wirkung. Antwort in der Regel innerhalb weniger Tage.

`cue` ist eine selbst gehostete Einzelinstanz ohne Release-Kanal — ein Fix geht
direkt in `main` und von dort auf die Instanz.

## Was hier geschützt wird

Eine Instanz hält die Prompts, Projekte und Screenshots mehrerer Konten, den
Zugang zu einer Maschine, auf der Code ausgeführt werden kann, und die
API-Schlüssel einzelner Nutzer. Die vier Grenzen, die dabei zählen:

1. **Zwischen den Konten.** Kein Nutzer sieht die Daten eines anderen.
2. **Zwischen Nutzer und Maschine.** Nur der Betreiber darf etwas auslösen, das
   auf dem Runner-Mac läuft.
3. **Zwischen Browser und Server.** Sitzungen sind nicht fälschbar,
   schreibende Anfragen nicht von fremden Seiten auslösbar.
4. **Zwischen den Geldbeuteln.** Wer die KI-Optimierung nutzt, bezahlt sie mit
   dem eigenen Schlüssel; ein fremder Schlüssel ist weder lesbar noch
   verwendbar.

## Wie

### Anmeldung

Google OAuth 2.0, **Authorization-Code-Flow**. Der Code wird serverseitig gegen
ein Token getauscht; das Client-Secret erreicht den Browser nie. Passwörter gibt
es nicht, also auch keine zu verlieren.

- Der `state`-Parameter ist ein kurzlebiges signiertes Token und wird gegen ein
  eigenes Cookie geprüft. Nur dieses Cookie ist `SameSite=Lax` — es muss Googles
  Weiterleitung überleben; die Sitzung selbst bleibt `Strict`.
- Nicht bestätigte E-Mail-Adressen werden abgewiesen.
- **Anmelden darf jeder, Daten sieht nur, wer freigeschaltet ist.** Die Prüfung
  sitzt in `current_user_id`, also greift ein Entzug bei der **nächsten
  Anfrage** — nicht erst beim Ablauf der Sitzung.

### Sitzung und CSRF

Das Sitzungs-Token ist signiert (`itsdangerous`) und trägt die Nutzer-ID sowie
ein CSRF-Geheimnis. Es gibt **keinen serverseitigen Sitzungsspeicher**; das
lesbare `cue_csrf`-Cookie spiegelt das Geheimnis nur für das Double-Submit.

Cookies: `HttpOnly`, `Secure` (hinter dem Proxy), `SameSite=Strict`.
Jede mutierende Anfrage braucht den Header `X-CSRF-Token` **und** besteht eine
Origin-Prüfung gegen `ALLOWED_ORIGIN`.

### Mandantentrennung

Jede Abfrage ist auf `user_id` gefiltert, jeder Zugriff auf eine einzelne Zeile
prüft den Besitz erneut. **Ein fremder Datensatz ergibt 404, nie 403** —
„verboten" würde bestätigen, dass er existiert.

Durchgesetzt wird das nicht durch Disziplin, sondern durch einen Test, der über
**jede** Route läuft (`backend/tests/test_tenancy.py`): ungeschützte Endpunkte
brauchen eine schriftliche Begründung in einer Ausnahmeliste, aus der veraltete
Einträge automatisch auffallen.

### Codeausführung

Die gefährlichste Funktion der App ist, dass sie die Claude-Code-CLI ausführt.
Deshalb:

- **Der Server ruft nie eine Shell auf.** Er reiht einen Job ein; abgeholt wird
  er vom Mac-Daemon. Auf dem VPS gibt es weder die CLI noch deren Zugangsdaten.
- **Nur der Betreiber** (`OWNER_EMAIL`) kann Runs und CLI-Deliveries auslösen —
  auch andere freigeschaltete Konten nicht. Die Grenze verläuft entlang der
  **fremden Maschine**: die Optimierung darf inzwischen auch, wer einen eigenen
  API-Key hinterlegt hat (`require_optimizer`), weil dieser Weg im Container
  läuft und keine Shell anfasst.
- **Pfad-Whitelist** (`ALLOWED_PROJECT_BASES`), serverseitig geprüft und im
  Runner ein zweites Mal.
- **Kein `shell=True`, nirgends.** Argumente gehen als eigene argv-Elemente
  (`create_subprocess_exec`); der Prompt ist ein Argument, kein Kommandotext.
  Terminal- und Pane-Kennungen werden validiert, bevor sie in ein AppleScript
  oder einen `tmux`-Aufruf gelangen.
- **Runner-Geheimnisse werden aus der Kindumgebung entfernt**, Modellnamen, die
  wie Flags aussehen, verworfen; Größen-, Zeit- und Ausgabegrenzen gelten auf
  beiden Seiten.

### Fremde API-Schlüssel

Ein Nutzer kann einen eigenen Anthropic-API-Key hinterlegen, um die Optimierung
auf eigene Rechnung laufen zu lassen. Ein solcher Schlüssel ist ein Zahlungs-
mittel, also gilt:

- **Verschlüsselt gespeichert.** Fernet (AES-128-CBC + HMAC) mit einem aus
  `SECRET_KEY` abgeleiteten Schlüssel (PBKDF2-SHA256, 200 000 Runden, eigener
  Domain-Salt) — `app/secrets_store.py`. Ein rotierter `SECRET_KEY` macht
  bestehende Schlüssel unlesbar; das degradiert bewusst zu „kein Schlüssel
  hinterlegt" statt zu einem Fehler.
- **Er kommt nie zurück.** Die API liefert ausschließlich eine Vorschau
  (`…ABCD`) und ein Ja/Nein. Es gibt keinen Endpunkt, der einen gespeicherten
  Schlüssel im Klartext ausgibt — auch nicht für den Betreiber, auch nicht für
  den Eigentümer selbst.
- **Vor dem Speichern geprüft.** Ein neuer Schlüssel wird mit einem minimalen
  Aufruf verifiziert, damit ein Tippfehler sofort auffällt und nicht erst, wenn
  ein Job scheitert.
- **Kein Weg zurück in fremde Jobs.** Die Claim-Abfrage des Runners filtert auf
  `providers.runner_ids()`; ein Job, der gegen einen Nutzer-Schlüssel laufen
  soll, kann vom Mac gar nicht übernommen werden.
- **Ausgeben und Lesen sind getrennte Rechte.** Einen Job anstoßen braucht einen
  Schlüssel (oder den Betreiber-Status), einen bereits bezahlten Vorschlag lesen,
  übernehmen oder verwerfen nicht — sonst würde das Entfernen des Schlüssels
  rückwirkend Arbeit sperren, die schon bezahlt ist.

### Auslieferung

- Strikte **CSP** (`script-src 'self'` — deshalb liegt das Pre-Paint-Theme-
  Skript in `public/boot.js` und nicht inline), dazu die üblichen
  Security-Header. HSTS macht der Reverse Proxy.
- **Path-Traversal-Schutz** beim Ausliefern des SPA und der Screenshots;
  Screenshots gehen bewusst **nicht** als statische Dateien raus, sondern durch
  einen Endpunkt mit Besitzprüfung.
- **Rate-Limit** auf der Anmeldung. `TRUST_PROXY` entscheidet, ob
  `X-Forwarded-For` überhaupt geglaubt wird — sonst zählt der Socket-Peer, damit
  sich das Limit nicht per Header umgehen lässt.
- **Markdown wird escape-first gerendert**: erst wird alles maskiert, dann die
  erlaubte Teilmenge angewandt. Ein DOM-basierter Test prüft, dass **kein**
  fremdes Element und **überhaupt kein Attribut** entsteht.

### Token

Neben der Sitzung gibt es drei Bearer-Token: `RUNNER_TOKEN` (Maschine),
`CAPTURE_TOKEN` bzw. das Token je Nutzer (Prompt-Capture) und das
Snippet-Sync-Token. Sie sind absichtlich getrennt: eines davon offenzulegen darf
nicht die anderen Wege öffnen. `backend/tests/test_security_tokens.py` ist fast
vollständig negativ — manipuliert, abgeschnitten, quer signiert, abgelaufen,
zweckentfremdet —, weil eine gültige Signatur hier **die** Autorisierung ist und
eine kaputte Prüfung still aufhört zu prüfen.

## Grenzen — was hier ausdrücklich nicht behauptet wird

- **Der Betreiber sieht alles.** Es gibt keine Verschlüsselung, die ihn
  ausschließt; die SQLite-Datei liegt im Klartext auf dem Server.
- **Prompt-Inhalte gehen an Anthropic**, sobald ein Run oder eine Optimierung
  läuft — das ist der Zweck der Funktion.
- **Kein Ausgabenlimit.** Ein hinterlegter Schlüssel begrenzt, *wessen* Konto
  belastet wird, nicht *wie viel*. Ein Kostendeckel gehört in die Anthropic-
  Konsole; die Statistik zeigt die Ausgaben, sie bremst sie nicht.
- **Die Kostenzahlen sind teils Schätzung.** Über die Messages API werden sie
  aus der Usage und einer im Code gepflegten Preistabelle gerechnet
  (`pricing.STATE` nennt deren Stand) — eine veraltete Tabelle ergibt eine
  falsche, aber datierte Zahl.
- **Kein Audit-Log für Lesezugriffe.** Änderungen sind über das Ereignis-Log
  nachvollziehbar, Lesen nicht.
- **Screenshots werden nach 30 Tagen gelöscht**, aber es gibt kein sicheres
  Überschreiben.
- **Kein Off-Site-Backup.** Die nächtliche Sicherung liegt auf demselben Host.
- **Nicht auditiert.** Eine Einzelinstanz, geschrieben und betrieben von einer
  Person.

## Für Betreiber

- `SECRET_KEY` mit `openssl rand -hex 32` erzeugen und **nie** committen; die
  `.env` bleibt auf dem Server (deshalb beim Ausrollen **kein** `rsync --delete`).
- `COOKIE_SECURE=true` und `TRUST_PROXY=true` hinter dem Proxy.
- `CUE_DEV` niemals auf einem erreichbaren Host — es schaltet die Start-Prüfung,
  die geschlossene Allowlist, die Origin-Prüfung und die Owner-Sperre ab.
- `OPTIMIZE_MODEL` gesetzt lassen, sonst entscheidet der Zustand der CLI auf dem
  Runner-Mac, was deine Prompts umschreibt.
- **`SECRET_KEY` rotieren heißt: alle hinterlegten API-Schlüssel sind weg.** Die
  Nutzer tragen sie danach neu ein; ein Fehler entsteht nicht, die Optimierung
  fällt still auf „kein Schlüssel" zurück.
- Nach jedem Deploy zeigt `/api/health` den Zustand; die nächtliche Sicherung
  prüft jede Kopie mit `PRAGMA integrity_check` und verwirft sie bei Fehlern.
