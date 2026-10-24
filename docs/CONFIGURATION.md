# Konfiguration

Alle Einstellungen kommen aus der Umgebung, gelesen in
[`backend/app/config.py`](../backend/app/config.py). Vorlage zum Kopieren:
[`.env.example`](../.env.example).

> Diese Tabelle ist **testgepinnt**: `backend/tests/test_docs.py` schlägt fehl,
> sobald eine Einstellung im Code auftaucht, die hier fehlt — oder hier eine
> steht, die es im Code nicht gibt. Eine Konfigurationsreferenz, die
> auseinanderlaufen darf, ist schlimmer als keine.

## Pflicht in Produktion

`validate()` bricht beim Start ab, wenn eines davon fehlt (außer unter
`CUE_DEV=1`). Fail-fast ist Absicht: ein Server, der ohne `SECRET_KEY`
hochkommt, signiert Sessions mit einem leeren Schlüssel.

| Variable | Bedeutung |
| --- | --- |
| `SECRET_KEY` | Signierschlüssel für Session- und OAuth-`state`-Token. Erzeugen mit `openssl rand -hex 32`. |
| `GOOGLE_CLIENT_ID` | OAuth-Client der Google Cloud Console (Webanwendung). |
| `GOOGLE_CLIENT_SECRET` | Zugehöriges Secret. Bleibt serverseitig, erreicht den Browser nie. |

## GitHub (optional)

Verbindet ein Konto mit GitHub, damit cue das Repository eines Projekts als
**Kontext** für Analyse und Optimierung lesen kann. Beide Werte werden einmalig
vom Betreiber hinterlegt. Ohne sie zeigt die KI-Einrichtung einen Hinweis zur
fehlenden GitHub-Konfiguration; Nutzer können mit ihrem eigenen API-Key bereits
ohne Repository arbeiten. `validate()` verlangt die beiden Werte nicht.

| Variable | Bedeutung |
| --- | --- |
| `GITHUB_CLIENT_ID` | Client-ID einer GitHub-OAuth-App. Callback-URL: `<ALLOWED_ORIGIN>/api/github/callback`. |
| `GITHUB_CLIENT_SECRET` | Zugehöriges Secret. Nur serverseitig. Der Scope ist `repo` (GitHub kennt für private Repos keinen reinen Lese-Scope); cue liest nur, speichert das Token verschlüsselt und widerruft es beim Trennen. |

### Einrichtung für Nutzer

Die OAuth-App wird **einmal vom Betreiber** eingerichtet. Danach braucht ein
freigeschalteter Nutzer nur „KI einrichten“ im Board zu öffnen:

1. Eigenen Anthropic-API-Key eingeben; cue prüft und verschlüsselt ihn.
   Der Betreiber kann seinen bestehenden CLI-Zugang behalten.
2. „Mit GitHub verbinden“ wählen und auf GitHub freigeben. Bei GitHub-Abbruch
   kommt man zum Ausgangspunkt zurück und kann es erneut versuchen.
3. Unter Projekte ein Repository auswählen (oder eine GitHub-URL einfügen).
   Die Auswahl zeigt zuerst die Namen, die dem Projektnamen am meisten ähneln.
   „Speichern & Kontext laden“ lädt den Kontext automatisch. „Zum Projekt-Board“
   öffnet anschließend das ausgewählte Projekt zum Analysieren und Optimieren.

GitHub ist optional. Ohne Repository bleibt die KI mit dem eigenen API-Key nutzbar.
Kein Nutzer muss Client-ID, Client-Secret oder Servereinstellungen eingeben.
Einrichtungsfortschritt und Fehler werden im selben Ablauf angezeigt.

### Repository-Vorschläge und Kontextanzeige

Die Vorschläge vergleichen den Repository-Namen mit dem Projektnamen. Bei
Projektpfaden wie `celox/celox-portal` zählt der letzte Abschnitt `celox-portal`.
Genaue Treffer stehen zuerst; danach folgen passende Wortfolgen, Namenspräfixe
und ähnliche Schreibweisen. Groß-/Kleinschreibung und Trennzeichen werden
angeglichen. Der GitHub-Kontoname beeinflusst die Bewertung nicht. Gleich gute
Treffer behalten die von GitHub gelieferte Reihenfolge. Das Suchfeld filtert
diese sortierte Liste; die Zuordnung wird mit „Speichern & Kontext laden“ bestätigt.

Der grüne Haken rechts oben am Projekt-Badge im Board zeigt gespeicherten
GitHub-Kontext an, auch bei Projekten ohne offene Prompts. Sein Tooltip nennt
Repository und Commitstand. Bei einem Abruffehler am selben Ziel bleibt ein
zuvor erfolgreich geladener Kontext erhalten; der Tooltip bezeichnet ihn als
letzten gespeicherten Stand. Ein Wechsel von Repository oder Branch verwirft
den alten Kontext. Die Projektansicht zeigt zusätzlich Alter, Zeichenanzahl
und Fehler sowie den Knopf „Aktualisieren“.

| Situation | Nächster Schritt |
| --- | --- |
| KI-Aktionen noch nicht freigeschaltet | Unter „KI einrichten“ den eigenen Anthropic-Key hinterlegen. |
| GitHub-Anmeldung abgebrochen oder abgelaufen | Erneut verbinden; die Rückkehr führt zum ausgewählten Projekt. |
| Repository fehlt in den Vorschlägen | Suche verwenden oder `owner/repository` bzw. die GitHub-URL direkt eingeben. |
| Repository oder Branch nicht gefunden | Verknüpfung und angemeldetes GitHub-Konto prüfen, dann erneut laden. |
| Aktualisierung fehlgeschlagen | Fehler am Projekt lesen und „Aktualisieren“ erneut versuchen. Der letzte gute Stand desselben Ziels bleibt nutzbar. |

### Automatische Token-Erneuerung

Apps mit aktivierter Token-Expiration werden unterstützt: Access- und Refresh-Token
bleiben serverseitig verschlüsselt, und cue erneuert den Zugang vor Ablauf automatisch.
Der genaue Ablauf ist in der [GitHub-Dokumentation](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#refreshing-an-access-token-with-a-refresh-token)
beschrieben. Alte Verbindungen ohne gespeichertes Refresh-Token werden einmal neu
verbunden. Ein GitHub-Ausfall entfernt die gespeicherte Verbindung nicht.

## Zugang und Sitzung

| Variable | Standard | Bedeutung |
| --- | --- | --- |
| `OWNER_EMAIL` | – | Der Admin. Übernimmt beim ersten Login die noch besitzerlosen Daten und ist der Einzige, der **Runs und CLI-Delivery** auslösen darf — beides führt Code auf dem Runner-Mac aus. Die **Optimierung** darf zusätzlich jeder mit eigenem API-Schlüssel (siehe unten). |
| `GOOGLE_ALLOWED_EMAILS` | – | Komma-Liste. Wirkt als **Auto-Freischaltung**, nicht als Sperre — anmelden kann sich jeder, freigeschaltet wird über die UI. |
| `GOOGLE_ALLOWED_DOMAINS` | – | Wie oben, auf Domain-Ebene. Beide leer heißt in Produktion: niemand wird automatisch freigeschaltet. |
| `SESSION_MAX_AGE` | `2592000` | Sitzungsdauer in Sekunden (30 Tage). |
| `COOKIE_SECURE` | `true` | Muss hinter dem TLS-terminierenden Proxy `true` bleiben. Im lokalen HTTP-Dev auf `false`. |
| `ALLOWED_ORIGIN` | `https://cue.celox.io` | Erlaubte Browser-Herkunft. Speist die CSP und die strenge Origin-Prüfung; daraus leitet sich auch die OAuth-Redirect-URI ab. |
| `TRUST_PROXY` | `true` | Ob `X-Forwarded-For` die Client-IP liefern darf. Nur einschalten, wenn ein vertrauenswürdiger Proxy den Header setzt — sonst ließe sich das Login-Rate-Limit umgehen. |

## Ablage

| Variable | Standard | Bedeutung |
| --- | --- | --- |
| `DB_PATH` | `data/cue.db` | Die SQLite-Datei. In Produktion auf dem Volume (`/data/cue.db`). |
| `UPLOAD_DIR` | `data/uploads` | Arbeitsverzeichnis für `.txt`-Importe (flüchtig). |
| `ATTACHMENTS_DIR` | `data/attachments` | Screenshots. **Gehört aufs Volume** — sonst sind sie nach dem nächsten Deploy weg, während die DB-Zeilen bleiben. |
| `MAX_ATTACHMENT_BYTES` | `10485760` | Obergrenze je Bild (10 MB), geprüft **nach** der WebP-Komprimierung im Browser. |
| `STATIC_DIR` | `static` | Verzeichnis des gebauten Frontends; setzt das Docker-Image. |

## Run-Engine

| Variable | Standard | Bedeutung |
| --- | --- | --- |
| `RUNNER_TOKEN` | – | Gemeinsames Geheimnis des Mac-Runners (`Authorization: Bearer …`). Ohne ihn kann kein Job übernommen werden. |
| `ALLOWED_PROJECT_BASES` | – | Komma-Liste absoluter Pfade auf der Runner-Maschine. Der `project_path` eines Laufs muss darunter liegen. Serverseitig geprüft **und** im Runner erneut. |
| `RUN_STALE_TIMEOUT` | `300` | Nach so vielen Sekunden ohne Herzschlag gilt ein Lauf als tot und wird eingesammelt. |

## Prompt-Optimierung

| Variable | Standard | Bedeutung |
| --- | --- | --- |
| `OPTIMIZE_ENABLED` | `true` | Schaltet die Funktion samt ✨-Knöpfen ab. |
| `OPTIMIZE_PROVIDER` | `claude_cli` | Backend-Kennung aus `app/optimization/providers.py`. Gilt für Nutzer **ohne** eigenen Schlüssel; wer einen hinterlegt hat, läuft immer über `anthropic_api`. |
| `OPTIMIZE_MODEL` | – (leer) | **Gesetzt lassen** (Produktion: `opus`). Leer heißt: kein `--model` erreicht die CLI, und der Optimierer rechnet mit dem, worauf die Claude-Code-CLI des Runner-Macs gerade steht — ein `/model` dort ändert dann still mit, womit deine Prompts umgeschrieben werden. |
| `OPTIMIZE_TIMEOUT` | `180` | Harte Laufzeitgrenze je Optimierung (Sekunden). |
| `OPTIMIZE_MAX_CHARS` | `24000` | Längere Prompts werden abgelehnt, bevor sie in die Warteschlange kommen. |
| `OPTIMIZE_MAX_RETRIES` | `1` | Wiederholungen bei einem vorübergehenden CLI-Fehler. Kontingent- und Auth-Fehler werden **nicht** wiederholt — dieselbe Fehlermeldung noch einmal zu erzeugen kostet nur Zeit. |
| `OPTIMIZE_STALE_GRACE` | `120` | Zusatzfrist über `OPTIMIZE_TIMEOUT` hinaus, bevor ein übernommener Job als tot gilt. |

### Der Schlüssel je Nutzer steht nicht in der Umgebung

Die Optimierung hat eine zweite Konfigurationsebene, und die liegt bewusst in
der **Datenbank** statt in der `.env`: jeder freigeschaltete Nutzer kann in
`Einstellungen → KI-Optimierung` einen eigenen Anthropic-API-Schlüssel und ein
Modell hinterlegen (`User.anthropic_key_enc`, verschlüsselt — siehe
[`../SECURITY.md`](../SECURITY.md); `User.optimize_model`).

Das ist keine Inkonsequenz, sondern folgt daraus, wem die Einstellung gehört:
eine Umgebungsvariable ist eine Aussage des **Betreibers** über die Instanz, ein
API-Schlüssel eine Aussage eines **Nutzers** über sein eigenes Konto. Praktisch
heißt das:

- Ist ein Schlüssel hinterlegt, läuft die Optimierung im Container gegen die
  Messages API und kostet den Nutzer Geld. `OPTIMIZE_PROVIDER` und
  `OPTIMIZE_MODEL` gelten dann nicht — es zählt, was in der UI steht.
- Ist keiner hinterlegt, gilt der alte Weg (Mac-Runner + CLI) und damit auch die
  Tabelle oben. Anstoßen darf ihn nur `OWNER_EMAIL`.
- ⚠️ **„Hinterlegt" heißt „lesbar".** Ein gespeicherter Schlüssel, der sich nicht
  mehr entschlüsseln lässt — nach einer Rotation von `SECRET_KEY` ist das der
  Normalfall —, ist für die Wegwahl kein Schlüssel. Ein fremder Nutzer bekommt
  dann eine Aufforderung, ihn neu zu hinterlegen, und **nicht** den CLI-Weg:
  sonst liefe fremde Arbeit auf der Maschine und der Rechnung des Eigentümers.
- `OPTIMIZE_ENABLED=false` schaltet **beide** Wege ab.

### Der Modell-Katalog steht ebenfalls nicht in der Umgebung

Welche Modelle auswählbar sind und welches ein neuer Prompt bekommt, liegt in
der **Datenbank** (`ai_model`, je Mandant) — dieselbe Begründung wie beim
API-Schlüssel oben: eine Umgebungsvariable ist eine Aussage des Betreibers über
die Instanz, der Katalog eine Aussage des Nutzers über seine Arbeit. Die
Start-Modelle stehen recherchiert in `app/aimodels/catalog.py` (mit Quelle und
Stand) und werden je Mandant genau einmal angelegt. Kommen in einer neuen
Katalog-Fassung (Konstante im Code, keine Variable) Modelle hinzu, bekommen bestehende Konten
genau diese nachgereicht — beim Start und beim nächsten Blick in den Katalog.

⚠️ `OPTIMIZE_MODEL` ist davon unberührt: es bestimmt, womit **optimiert** wird,
nicht, womit ein Prompt abgearbeitet werden soll. Nach einer Optimierung setzt
cue allerdings das dabei genutzte Claude-Code-Modell am Prompt, sofern der
Katalog einen passenden Eintrag hat.

## Prompt-Capture

| Variable | Standard | Bedeutung |
| --- | --- | --- |
| `CAPTURE_TOKEN` | – | Bearer-Token des Weiterleiters; die Prompts werden `OWNER_EMAIL` zugeordnet. Pro Nutzer geht es auch über die UI (Settings → Prompt-Capture). |
| `CAPTURE_BASE` | erster Eintrag aus `ALLOWED_PROJECT_BASES` | Basis, unter der aus einem `cwd` bzw. Git-Root ein Projektname wird. |

## Nur für lokale Entwicklung

| Variable | Standard | Bedeutung |
| --- | --- | --- |
| `CUE_DEV` | `false` | ⚠️ Schaltet **vier Produktionsschutzmaßnahmen** ab: die Start-Prüfung, die geschlossene Allowlist, die strenge Origin-Prüfung und die Owner-Sperre (wenn `OWNER_EMAIL` fehlt). Niemals auf einem erreichbaren Host setzen. |

## Zwei Fallstricke beim Ausrollen

**`$` in `.env` muss verdoppelt werden.** Docker Compose interpoliert
`env_file`, also wird aus `$` ein `$$` — sonst verschwinden Teile eines
Hash-artigen Wertes stillschweigend. Beim direkten Start von uvicorn gilt das
nicht, die Werte kommen dort wörtlich an.

**Beim Ausrollen kein `rsync --delete`.** Die `.env` liegt nur auf dem Server;
`--delete` löscht sie und die App startet danach nicht mehr.
