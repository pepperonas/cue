# Mitarbeiten

`cue` ist eine selbst gehostete Einzelinstanz, kein Produkt mit Release-Kanal.
Trotzdem gelten hier feste Regeln — sie stehen hier, weil sie in diesem Repo
schon Fehler verhindert haben, nicht weil sie gut klingen.

## Einrichten

```bash
git clone https://github.com/pepperonas/cue.git && cd cue

cd backend  && uv venv && uv pip install -e ".[dev]" && cd ..
cd frontend && pnpm install && cd ..

# Backend (Terminal A)
cd backend && CUE_DEV=1 COOKIE_SECURE=false uv run uvicorn app.main:app --reload --port 8000
# Frontend (Terminal B) — proxyt /api auf :8000
cd frontend && pnpm dev
```

`CUE_DEV=1` lockert die Start-Prüfung und öffnet die Allowlist. **Nie auf einem
erreichbaren Host** — es schaltet vier Produktionsschutzmaßnahmen ab
([CONFIGURATION.md](docs/CONFIGURATION.md)).

## Ein Beitrag ist erst fertig, wenn das alles stimmt

```bash
npm test          # vier Suiten + Lint, danach die Badges (posttest)
cd frontend && pnpm typecheck && pnpm build
```

1. **Tests grün** — alle vier Suiten.
2. **Jede neue Zusicherung einmal rot gesehen.** Siehe unten.
3. **Doku mitgeführt** — CHANGELOG-Eintrag, und bei neuen Einstellungen oder
   Endpunkten auch `docs/`. Sonst schlägt `test_docs.py` fehl.
4. **Version gebumpt** in `backend/app/main.py` — das ist die *einzige* Quelle;
   Badge und README ziehen automatisch nach.
5. **Conventional Commit.**

## Die Regeln, die hier tragen

### Ein Test, den man nicht hat scheitern sehen, ist keine Zusicherung

Jede neue Prüfung wird einmal absichtlich kaputtgemacht — Regel invertieren,
Schwelle entfernen, Guard streichen — und muss dabei rot werden. Das hat hier
wiederholt Tests entlarvt, die grün waren, ohne etwas zu prüfen. Details und
Beispiele: [docs/TESTING.md](docs/TESTING.md).

### Logik gehört nach `lib/`, nicht in die Komponente

React-Komponenten sind bewusst ungetestet. Steckt testenswerte Logik in einem
Hook, wird sie herausgezogen (`lib/live-sync.ts`, `lib/tag-keys.ts`,
`lib/media.ts`), bis im Hook nur noch Verdrahtung übrig ist.

### Abgeleitet schlägt gemerkt

Ein Wert, den man beim nächsten neuen Schreibpfad aktualisieren *müsste*, wird
irgendwann vergessen. Ein abgeleiteter Wert kann nicht vergessen werden — der
Live-Sync-Cursor ist deshalb ein Fingerabdruck über die Daten und kein Zähler.

### Eine Python-Abhängigkeit gehört in **zwei** Dateien

`backend/pyproject.toml` ist, was uv und die Tests installieren —
`backend/requirements.txt` ist, **was das Docker-Image installiert**. Nur eines
davon zu pflegen baut ein Image ohne das Paket, und der Fehler landet beim Import
in Produktion, nachdem der Health-Check den Container schon getauscht hat. Genau
das ist passiert; seitdem hält `backend/tests/test_deps_contract.py` beide Listen
deckungsgleich (Pakete **und** Versionsuntergrenzen), und `ops/deploy.sh`
importiert die App einmal im frischen Image, bevor es umschaltet.

### Sortierregeln gibt es dreimal — und nur unter zwei Bedingungen

Wo eine Karte in ihrer Spalte steht, ist in `backend/app/ordering.py`
(`display_key` **und** `BOARD_ORDER_SQL`) und in `frontend/src/lib/order.ts`
formuliert. Driften sie, wird ein Drag gespeichert und tut trotzdem nichts.
Änderungen laufen deshalb über `contracts/column-order.json`, das beide Sprachen
prüfen. Eine neue Regel darf **nur gespeicherte Felder** verwenden, und der
Nutzer muss sie **überstimmen können** — sonst wird das Ziehen in dem betroffenen
Block zu einem garantierten Nichts.

### Denormalisierte Spalten haben genau einen Schreiber

`Prompt.tags` geht ausschließlich über `TagService`, `Snippet.group_name`
ausschließlich über den Gruppen-Pfad. Direkt schreiben lässt beides driften.

### Keine Zahl in eine Commit-Nachricht, bevor sie gemessen ist

Geschätzte Messwerte in Commit-Nachrichten mussten hier schon per `amend`
berichtigt werden. Erst messen, dann schreiben.

### Keine nativen Browser-Dialoge

`window.prompt/confirm/alert` sind verboten. Es gibt `Confirm` und
`InputDialog`.

### Jedes Overlay ruft `useBackDismiss(onClose)`

Das ist der einzige Anmeldepunkt für Zurück-Geste **und** Escape. Keine zweite
Escape-Kette bauen.

## Stil

- **Sprache**: Oberfläche und Dokumentation deutsch, Code und Commits englisch.
- **Kommentare erklären das *Warum*.** Was der Code tut, steht im Code. Ein
  Kommentar, der eine entfernte Regel wörtlich zitiert, bricht Textprüfungen —
  solche Prüfungen laufen deshalb kommentarfrei.
- **Lint**: Fehler blockieren, Warnungen sind ein geprüfter Rückstand. Eine
  Warnung nicht dadurch beseitigen, dass funktionierender Code umgeschrieben
  wird — erst prüfen, dann entweder beheben oder stehen lassen.
- **TypeScript strict**, keine ungenutzten Bindungen.

## Commit-Nachrichten

[Conventional Commits](https://www.conventionalcommits.org/):

```
feat: Tag-Feld trennt "nimm den Vorschlag" von "nimm mein Wort" (v0.46.0)
fix:  Escape im Tag-Feld schloss den ganzen Dialog
docs: API-Referenz und Konfigurationsdoku, testgepinnt
```

Der Rumpf beantwortet **warum** und nennt, was gemessen wurde. Die Historie
dieses Repos ist die eigentliche Begründungsdokumentation — sie ist die Mühe
wert.

## Ausrollen

Siehe [README](README.md#deployment). Drei Dinge, die teuer waren:

- **`rsync` ohne `--delete`** — die `.env` liegt nur auf dem Server.
- **`ops/deploy.sh` baut zuerst.** Ein kaputter Build lässt die Produktion
  unangetastet; das Umschalten schließt den Port für rund vier Sekunden, in
  denen der Proxy eine Wartungsseite ausliefert.
- **Das frische Image wird einmal importiert**, bevor umgeschaltet wird — ein
  grüner Health-Check kam schon einmal zu spät, weil das Image eine
  Abhängigkeit gar nicht enthielt.

## Lizenz

Mit einem Beitrag stimmst du zu, dass er unter der [MIT-Lizenz](LICENSE) steht.
