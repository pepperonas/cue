# API-Referenz

Alle Endpunkte liegen unter **`/api`** (FastAPI-Sub-App). Interaktiv:
`/api/docs` auf einer laufenden Instanz.

> Diese Liste ist **testgepinnt**: `backend/tests/test_docs.py` vergleicht sie
> mit den tatsächlichen Route-Dekoratoren und schlägt fehl, sobald ein Endpunkt
> hinzukommt, verschwindet oder umzieht, ohne dass er hier steht.

## Wer darf was

Fünf Zugangsarten, sichtbar an der Abhängigkeit im Router:

| Gate | Wer | Wie |
| --- | --- | --- |
| `current_user_id` | jeder freigeschaltete Nutzer | signiertes `cue_session`-Cookie; **jede** Abfrage ist auf den Mandanten gefiltert |
| `require_owner` | nur `OWNER_EMAIL` | alles, was Code auf der **Runner-Maschine** ausführt: Runs und CLI-Delivery |
| `require_optimizer` | Besitzer **oder** wer einen eigenen API-Key hinterlegt hat | eine Optimierung *anstoßen* — sie kostet Geld, also braucht sie ein Konto, das dafür geradesteht |
| `require_runner` | der Mac-Daemon | `Authorization: Bearer $RUNNER_TOKEN` — **kein** Cookie, kein CSRF |
| Bearer-Token je Nutzer | Capture-Weiterleiter, Inspector Rust | eigenes Token pro Konto |

**Ausgeben und Lesen sind getrennt.** Eine Optimierung *einreihen* braucht
`require_optimizer`; einen fertigen Vorschlag lesen, übernehmen oder verwerfen
braucht nur die Mandantenprüfung. Sonst hätte das Entfernen des eigenen Keys
Arbeit gesperrt, die bereits bezahlt ist.

**Schreibende Anfragen brauchen CSRF.** Jede mutierende Anfrage einer
Cookie-Sitzung führt `require_csrf` und damit den Header `X-CSRF-Token` mit dem
Wert des lesbaren `cue_csrf`-Cookies (Double Submit) plus eine Origin-Prüfung.
Die Maschinen-Endpunkte sind davon ausgenommen — sie tragen kein Cookie, also
gibt es nichts zu fälschen.

**Ein fremder Datensatz ergibt 404, nie 403.** „Verboten" würde bestätigen, dass
die Zeile existiert. Ein Test fegt dafür ein zweites Konto über jede besitzbare
Ressource.

## Statuscodes

| Code | Bedeutung hier |
| --- | --- |
| `400` | fachlich unmöglich (z. B. optimieren, was nicht in der Queue liegt) |
| `401` | keine gültige Sitzung |
| `403` | CSRF fehlt/passt nicht, falsche Herkunft, owner-only, nicht freigeschaltet |
| `404` | gibt es nicht — **oder gehört jemand anderem** |
| `409` | Konflikt (z. B. Delivery-Ziel ist verschwunden) |
| `422` | Validierung (Pydantic) |
| `429` | Rate-Limit (Anmeldung) |

## Endpunkte

### Anmeldung

<sub>`backend/app/routers/auth.py`</sub>

| Methode | Pfad | Beschreibung |
| --- | --- | --- |
| `GET` | `/auth/google/login` | Startet den OAuth-Flow: signiert einen `state`, setzt ihn als `SameSite=Lax`-Cookie, leitet zu Google weiter. |
| `GET` | `/auth/google/callback` | Prüft `state`, tauscht den Code gegen ein Token, holt das Profil, legt den Nutzer an bzw. meldet ihn an. |
| `GET` | `/auth/me` | `{authenticated, approved, csrf_token, user}` — die Grundlage für Login-Gate und CSRF-Header. |
| `POST` | `/auth/logout` | Löscht Session- und CSRF-Cookie. |

### Verwaltung

<sub>`backend/app/routers/admin.py`</sub>

| Methode | Pfad | Beschreibung |
| --- | --- | --- |
| `GET` | `/admin/users` | Alle Konten mit Freischaltstatus. Nur `OWNER_EMAIL`. |
| `PATCH` | `/admin/users/{user_id}` | Konto freischalten oder sperren. Selbstaussperren ist blockiert. |

### Projekte

<sub>`backend/app/routers/projects.py`</sub>

| Methode | Pfad | Beschreibung |
| --- | --- | --- |
| `GET` | `/projects` | Projekte des Kontos, in der manuellen Reihenfolge. |
| `POST` | `/projects` | Neues Projekt (Name pro Konto eindeutig). |
| `PATCH` | `/projects/{project_id}` | Name oder Farbe ändern. |
| `POST` | `/projects/reorder` | Manuelle Reihenfolge setzen. |
| `DELETE` | `/projects/{project_id}` | Projekt löschen; die Prompts verlieren nur ihre Zuordnung. |

### Prompts

<sub>`backend/app/routers/prompts.py`</sub>

| Methode | Pfad | Beschreibung |
| --- | --- | --- |
| `GET` | `/prompts` | Alle Prompts des Kontos (`?q=` durchsucht Titel und Text). |
| `POST` | `/prompts` | Anlegen. Ein leerer Titel wird aus der ersten Textzeile abgeleitet; ein Bug-Tag setzt den Prompt an den Anfang der Queue. |
| `GET` | `/prompts/{prompt_id}` | Einzelner Prompt samt Screenshots. |
| `PATCH` | `/prompts/{prompt_id}` | Ändern. Statuswechsel stempeln `ran_at`, ein Weg aus **done** löscht das Getestet-Kennzeichen. |
| `DELETE` | `/prompts/{prompt_id}` | Löschen samt Screenshot-Dateien und Optimierungs-Historie. |
| `POST` | `/prompts/{prompt_id}/duplicate` | Kopie — entweder an Ort und Stelle (`in_place`) oder in ein anderes Projekt. |
| `POST` | `/prompts/merge` | Mehrere Prompts zu einem zusammenführen; die Quellen werden gelöscht, archiviert oder behalten. Das Ergebnis landet oben in seiner Spalte. |
| `POST` | `/prompts/move` | Eine ganze Auswahl in einem Zug verschieben — als zusammenhängender Block in Board-Reihenfolge. |
| `POST` | `/prompts/{prompt_id}/move` | Einen Prompt verschieben, verankert an einem **Nachbarn** (`before_id`/`after_id`/`top`), nicht an einem Index. |
| `POST` | `/prompts/{prompt_id}/bookmarks/move` | Dasselbe innerhalb der Bookmark-Spalte. |
| `POST` | `/prompts/reorder` | Reihenfolge einer kompletten Spalte setzen (Altweg; das Board nutzt `move`). |
| `POST` | `/prompts/bookmarks/reorder` | Wie oben für Bookmarks. |

**Vier Felder bestimmen die Reihenfolge mit**, und der Server sortiert genauso
wie der Client, weil ein Verschiebe-Anker eine **sichtbare** Nachbarkarte nennt:
`blocked` (immer ganz unten), `tested` (in *done* unter die ungetesteten),
`test_closely` (in *done* nach oben) und `priority` (`high`/`normal`/`low`, wirkt
nur in *queued*). Die verbindliche Fassung ist
[`contracts/column-order.json`](../contracts/column-order.json) — siehe
[`ARCHITECTURE.md`](ARCHITECTURE.md#eine-regel-drei-spiegel-die-spaltenordnung).
Zwei Invarianten setzt der Server durch: `tested` ohne `done` ergibt **400**, und
jeder Weg aus *done* heraus löscht die Kennzeichen wieder.

### Tags

<sub>`backend/app/routers/tags.py`</sub>

| Methode | Pfad | Beschreibung |
| --- | --- | --- |
| `GET` | `/tags` | Tag-Vokabular mit Verwendungszahl, Herkunft und letzter Nutzung. |
| `POST` | `/tags` | Tag anlegen. |
| `GET` | `/tags/{tag_id}/usage` | Welche Prompts hängen daran — die Vorschau vor dem Löschen. |
| `PATCH` | `/tags/{tag_id}` | Umbenennen. Auf einen bestehenden Namen umbenennen **führt zusammen**. |
| `DELETE` | `/tags/{tag_id}` | Löschen, optional mit `?replace_with=` statt ersatzlos. |

### Screenshots

<sub>`backend/app/routers/attachments.py`</sub>

| Methode | Pfad | Beschreibung |
| --- | --- | --- |
| `POST` | `/attachments` | Bild hochladen (nur Bilder, Größenlimit). Landet zunächst ohne Prompt-Bezug. |
| `GET` | `/attachments` | Screenshots des Kontos. |
| `GET` | `/attachments/{attachment_id}` | Datei ausliefern — mit Besitzprüfung, deshalb nicht statisch. |
| `DELETE` | `/attachments/{attachment_id}` | Screenshot löschen. |

### Import & Export

<sub>`backend/app/routers/importexport.py`</sub>

| Methode | Pfad | Beschreibung |
| --- | --- | --- |
| `POST` | `/import` | `.txt` importieren (Trennung an `---`, Leerzeilen oder gar nicht). |
| `GET` | `/export` | JSON-Backup des Kontos. |
| `GET` | `/export/txt` | ZIP mit einer `.txt` je Prompt. |

### Runs

<sub>`backend/app/routers/runs.py`</sub>

| Methode | Pfad | Beschreibung |
| --- | --- | --- |
| `GET` | `/runs/config` | Erlaubte Basen, Modelle, Schalter. Ein 403 blendet die Run-Oberfläche aus. |
| `POST` | `/runs` | Lauf anlegen — ein Schritt oder eine Kette in einer Claude-Session. |
| `GET` | `/runs` | Läufe mit Fortschritt (`steps_done`/`steps_total`). |
| `GET` | `/runs/{run_id}` | Detail samt Log-Schwanz (`?after_seq=`). |
| `POST` | `/runs/{run_id}/cancel` | Abbrechen — laufend wird markiert, wartend sofort beendet. |
| `POST` | `/runs/claim` | **Runner**: nächsten Lauf atomar übernehmen (Long-Poll über `?wait=`). |
| `POST` | `/runs/{run_id}/heartbeat` | **Runner**: Lebenszeichen; die Antwort trägt einen Abbruchwunsch. |
| `POST` | `/runs/{run_id}/log` | **Runner**: Log-Zeilen anhängen. |
| `POST` | `/runs/{run_id}/steps/{idx}/result` | **Runner**: Ergebnis eines Schritts; verschiebt den Prompt nach done bzw. failed. |
| `POST` | `/runs/{run_id}/result` | **Runner**: Gesamtergebnis. |

### Prompt-Optimierung

<sub>`backend/app/routers/optimize.py`</sub>

| Methode | Pfad | Beschreibung |
| --- | --- | --- |
| `GET` | `/optimizations/config` | Ob die Funktion verfügbar ist. 403 für alle, die weder Besitzer sind noch einen eigenen API-Key hinterlegt haben — genau das blendet die Funktion in der Oberfläche aus. |
| `GET` | `/optimizations/key` | Status des **eigenen** Anthropic-Keys: ob einer hinterlegt ist, eine maskierte Endung, das gewählte Modell und die Preisliste. Der Key selbst wird nie zurückgegeben. Für jeden freigeschalteten Nutzer erreichbar — das Hinterlegen ist der Weg, die Optimierung überhaupt zu bekommen. |
| `PUT` | `/optimizations/key` | Eigenen Key setzen (`""` entfernt ihn) und/oder das Modell wählen. Der Key wird vor dem Speichern gegen die API geprüft und verschlüsselt abgelegt. |
| `POST` | `/optimizations` | Optimierung einreihen. Nur für Prompts in der **Queue**. |
| `GET` | `/optimizations` | Aktive und vergangene Versuche. |
| `GET` | `/optimizations/{optimization_id}` | Ein Versuch mit Text, Modell, Dauer, Kosten, Tokens. |
| `POST` | `/optimizations/{optimization_id}/cancel` | Laufende Optimierung abbrechen. |
| `POST` | `/optimizations/{optimization_id}/apply` | Vorschlag übernehmen — erst hier wird `Prompt.body` geschrieben. |
| `POST` | `/optimizations/{optimization_id}/discard` | Vorschlag verwerfen; der Text bleibt in der Historie lesbar. |
| `POST` | `/optimizations/batch` | Alle infrage kommenden Prompts einreihen. |
| `GET` | `/optimizations/batch/active` | Der laufende Stapel, für die Fortschrittsanzeige. |
| `GET` | `/optimizations/batch/{batch_id}` | Ein Stapel im Detail. |
| `POST` | `/optimizations/batch/{batch_id}/cancel` | Stapel abbrechen; ein bereits laufender Job läuft aus. |
| `POST` | `/optimizations/claim` | **Runner**: nächsten Job atomar übernehmen. |
| `POST` | `/optimizations/{optimization_id}/result` | **Runner**: Ergebnis melden. |

### Prompt-Capture & CLI-Delivery

<sub>`backend/app/routers/capture.py`</sub>

| Methode | Pfad | Beschreibung |
| --- | --- | --- |
| `POST` | `/capture` | **Weiterleiter**: getippte CLI-Prompts einliefern (Bearer). Dedupliziert über `(session, seq)`. |
| `GET` | `/sessions` | Capture-Sessions, nach Projekt gruppiert. |
| `GET` | `/sessions/{session_pk}` | Prompt-Verlauf einer Session, neueste zuerst. |
| `POST` | `/sessions/{session_pk}/prompts/{cp_id}/promote` | Einen mitgeschriebenen Prompt in die Queue übernehmen. |
| `DELETE` | `/sessions/{session_pk}` | Session samt Verlauf löschen. |
| `GET` | `/capture/settings` | Eigener Capture-Token und Basis-Pfad. |
| `POST` | `/capture/settings` | Basis setzen bzw. Token neu erzeugen. |
| `POST` | `/sessions/{session_pk}/send` | Prompt in eine **laufende** CLI-Session tippen (owner-only). |
| `GET` | `/cli/claim` | **Runner**: nächste Delivery übernehmen. |
| `POST` | `/cli/{delivery_id}/result` | **Runner**: Ergebnis der Delivery. |
| `GET` | `/cli/{delivery_id}` | Zustand einer Delivery (der Client pollt darauf). |

### Snippets

<sub>`backend/app/routers/snippets.py`</sub>

| Methode | Pfad | Beschreibung |
| --- | --- | --- |
| `GET` | `/snippets/groups` | Snippet-Gruppen inklusive leerer. |
| `POST` | `/snippets/groups` | Gruppe anlegen. |
| `PATCH` | `/snippets/groups/{group_id}` | Umbenennen; der denormalisierte Gruppenname wird in einer Transaktion nachgezogen. |
| `DELETE` | `/snippets/groups/{group_id}` | Gruppe löschen. |
| `POST` | `/snippets/groups/reorder` | Gruppenreihenfolge setzen. |
| `POST` | `/snippets/import` | IR-Backup einlesen (voller Envelope, snippets-only oder Legacy-Liste). |
| `GET` | `/snippets/export` | Als IR-Backup exportieren, optional `?groups=a,b`. |
| `GET` | `/snippets` | Alle Snippets. |
| `POST` | `/snippets` | Snippet anlegen (Abkürzung pro Konto eindeutig). |
| `GET` | `/snippets/{snippet_id}` | Einzelnes Snippet. |
| `PATCH` | `/snippets/{snippet_id}` | Ändern — die Version zählt nur bei **inhaltlichen** Änderungen hoch. |
| `DELETE` | `/snippets/{snippet_id}` | Löschen; hinterlässt einen Grabstein für den Sync. |
| `POST` | `/snippets/reorder` | Reihenfolge setzen. |
| `POST` | `/snippets/bulk-move` | Auswahl in eine Gruppe verschieben. |
| `POST` | `/snippets/bulk-delete` | Auswahl löschen. |

### Snippet-Sync

<sub>`backend/app/routers/sync.py`</sub>

| Methode | Pfad | Beschreibung |
| --- | --- | --- |
| `GET` | `/sync/snippets` | **Inspector Rust**: Snippets und Grabsteine abholen (Bearer-Sync-Token). |
| `POST` | `/sync/snippets` | **Inspector Rust**: Änderungen zurückschreiben. |
| `GET` | `/sync/settings` | Sync-Token und Geltungsbereich. |
| `POST` | `/sync/settings` | Token neu erzeugen bzw. Geltungsbereich setzen. |

### Live-Aktualisierung

<sub>`backend/app/routers/changes.py`</sub>

| Methode | Pfad | Beschreibung |
| --- | --- | --- |
| `GET` | `/changes` | Long-Poll für die geräteübergreifende Aktualisierung. Antwortet, sobald sich der Fingerabdruck ändert. |

### Statistiken

<sub>`backend/app/routers/stats.py`</sub>

| Methode | Pfad | Beschreibung |
| --- | --- | --- |
| `GET` | `/stats` | Aggregiertes Statistik-Paket für einen Zeitraum, gerechnet in der Zeitzone des Browsers. |

## Long-Poll

`GET /changes` und die drei Claim-Endpunkte des Runners nehmen `?wait=<s>`
(max. 25 s) und halten die Anfrage offen, bis es etwas zu berichten gibt.

Drei Bedingungen, die dabei zusammengehören:

1. Die Wartezeit muss klar unter dem `proxy_read_timeout` des Reverse Proxy
   liegen (nginx: 60 s) — sonst kappt der Proxy, bevor die App antwortet.
2. Der Client-Timeout muss größer sein als die Wartezeit, sonst bricht der
   Aufrufer genau die Anfrage ab, die er offenhalten wollte.
3. Diese Endpunkte nehmen **kein** `Depends(get_session)` — eine parkende
   Anfrage darf keine der fünf Pool-Verbindungen belegen.

`?wait=0` schaltet das Warten ab und stellt das alte Verhalten mit festem
Intervall wieder her.
