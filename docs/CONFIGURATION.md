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

## Zugang und Sitzung

| Variable | Standard | Bedeutung |
| --- | --- | --- |
| `OWNER_EMAIL` | – | Der Admin. Übernimmt beim ersten Login die noch besitzerlosen Daten und ist der Einzige, der Runs, Optimierung und CLI-Delivery auslösen darf. |
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
| `OPTIMIZE_PROVIDER` | `claude_cli` | Backend-Kennung aus `app/optimization/providers.py`. |
| `OPTIMIZE_MODEL` | – (leer) | **Gesetzt lassen** (Produktion: `opus`). Leer heißt: kein `--model` erreicht die CLI, und der Optimierer rechnet mit dem, worauf die Claude-Code-CLI des Runner-Macs gerade steht — ein `/model` dort ändert dann still mit, womit deine Prompts umgeschrieben werden. |
| `OPTIMIZE_TIMEOUT` | `180` | Harte Laufzeitgrenze je Optimierung (Sekunden). |
| `OPTIMIZE_MAX_CHARS` | `24000` | Längere Prompts werden abgelehnt, bevor sie in die Warteschlange kommen. |
| `OPTIMIZE_MAX_RETRIES` | `1` | Wiederholungen bei einem vorübergehenden CLI-Fehler. Kontingent- und Auth-Fehler werden **nicht** wiederholt — dieselbe Fehlermeldung noch einmal zu erzeugen kostet nur Zeit. |
| `OPTIMIZE_STALE_GRACE` | `120` | Zusatzfrist über `OPTIMIZE_TIMEOUT` hinaus, bevor ein übernommener Job als tot gilt. |

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
