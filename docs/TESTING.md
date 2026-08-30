# Testen

Vier Suiten, alle deterministisch und offline lauffähig. Externe Abhängigkeiten
— Google OAuth, Subprozesse, Browser-APIs — sind gemockt; kein Test braucht
Netz, und keiner braucht eine laufende Instanz.

```bash
npm test          # alle vier Suiten, danach die README-Badges (posttest-Hook)

npm run test:backend     # cd backend    && uv run pytest -q
npm run test:runner      # cd cue-runner && .venv/bin/python -m pytest -q
npm run test:frontend    # cd frontend   && pnpm vitest run
npm run test:scripts     # node --test scripts/tests/
npm run lint             # eslint (Fehler blockieren, Warnungen sind ein geprüfter Rückstand)

# einzelner Test
cd backend  && uv run pytest tests/test_tenancy.py::test_every_route_is_scoped
cd frontend && pnpm vitest run src/lib/tag-keys.test.ts
```

Die aktuellen Zahlen stehen als Badges im [README](../README.md) — sie werden
generiert, nicht getippt.

## Was wo getestet wird

| Suite | Ebene | Grundsatz |
| --- | --- | --- |
| `backend/tests/` | HTTP, black box | Gegen die echte API mit einer temporären SQLite. Kein Test greift in interne Funktionen; geprüft wird, was ein Client sieht. |
| `cue-runner/tests/` | Orchestrierung | Falsche Subprozesse, `httpx.MockTransport`, eine programmierbare `FakeApi`. Kein echter `claude`-Aufruf. |
| `frontend/src/lib/` | reine Module | Nur `lib/`. Komponenten sind **absichtlich** ungetestet. |
| `scripts/tests/` | Werkzeug | Die Parser des Badge-Generators — `node --test`, ohne Abhängigkeiten. |

### Warum die Frontend-Coverage auf `src/lib` begrenzt ist

Komponenten sind bewusst ungetestet. Über ganz `src/` gemessen käme eine Zahl
heraus, die niemand zu heben beabsichtigt — also misst die Messung genau das,
was auch gepflegt wird. Der Wert wurde eingeführt, nachdem der ungemessene
Zustand zwei echte Lücken verdeckt hatte: `lib/media.ts` stand bei 0 %, und von
`boardCollision` war nur die Konstruktion abgedeckt, keine der Regeln, für die
es existiert.

**Steckt testenswerte Logik in einem Hook, wird sie herausgezogen** statt einen
Renderer dafür zu bauen. `lib/media.ts` exportiert deshalb
`subscribeToMedia`/`matchMediaOrNull`, `lib/live-sync.ts` die komplette
Polling-Schleife als `createChangeLoop` (framework-frei, im Test von einem
Stub-Request plus `vi.useFakeTimers` getrieben), `lib/tag-keys.ts` die
Tastentabelle des Tag-Feldes. Was danach im Hook bleibt, ist Verdrahtung.

## Die Regel, die hier am meisten trägt

> **Ein Test, den man nicht hat scheitern sehen, ist keine Zusicherung.**

Jede neue Prüfung wird einmal **absichtlich kaputtgemacht** — die Regel im Code
invertiert, eine Schwelle entfernt, ein Guard gestrichen — und muss dabei rot
werden. Das ist keine Zeremonie: die Mutationsprobe hat in diesem Repo
wiederholt Tests entlarvt, die grün waren, ohne etwas zu prüfen.

Drei echte Fälle:

- Der wichtigste Pin für einen Hue-artigen Fehler blieb **grün**, obwohl der
  Fehler wieder eingebaut war — der Erklärkommentar an der Korrektur nannte
  zwangsläufig den richtigen Weg, und der Textvergleich fand ihn auch im
  kaputten Zustand. **Lehre: Textprüfungen auf Code laufen kommentarfrei.**
- „Tippen schlägt Kontext" (Tag-Ranking) prüfte mit einem Kontext-Tag, das die
  Suche ohnehin herausfiltert. Die Zusicherung hielt in beide Richtungen. Der
  unterscheidende Fall braucht **zwei Kandidaten, die beide durch den Filter
  kommen**, mit unterschiedlicher Trefferqualität.
- Zwei Tests der Live-Sync-Schleife lasen stärker, als sie waren: `stop()`
  bricht die laufende Anfrage ab, also erreichte „eine Antwort nach `stop()`"
  nie den Guard, den sie zu prüfen behauptete.

## Sechs Suiten prüfen eine Eigenschaft, nicht einen Aufrufort

Diese Tests existieren, weil die Fehler, gegen die sie schützen, niemand
absichtlich einbaut — es sind die, auf die niemand eine Regel *anwendet*.

**`test_tenancy.py`** läuft über **jede** Route der App und schlägt fehl, wenn
eine weder nach `current_user_id` filtert noch eine Maschine authentifiziert
noch mit einer **schriftlichen Begründung** in `UNSCOPED_BY_DESIGN` steht. Ein
zweiter Test entfernt veraltete Einträge aus dieser Liste, damit ein gelöschter
Endpunkt keinen Freibrief für das hinterlässt, was seinen Pfad erbt. Zusätzlich:
jeder mutierende Mandanten-Endpunkt trägt `require_csrf`, und ein zweites Konto
wird über jede besitzbare Ressource gefegt — erwartet wird **404, nie 403**.

**`contracts/column-order.json` + `test_ordering_contract.py` +
`order.contract.test.ts`** machen aus dem Spiegel zwischen Python und
TypeScript („änderst du eins, ändere das andere") etwas, das scheitern kann:
beide Sprachen fahren **dieselben 18 Fälle**, und dieselben Fälle laufen
zusätzlich einmal durch echtes SQLite — denn die Ordnung ist ein *drittes* Mal
als `ORDER BY` formuliert. Ein Platzhalter-Objekt wirft, sobald `display_key`
ein Feld liest, das ein Drag nicht beeinflussen kann.

**`test_security_tokens.py`** ist fast vollständig negativ — manipuliert,
abgeschnitten, quer signiert, abgelaufen, zweckentfremdet. Eine gültige Signatur
**ist** hier die Autorisierung, und jeder Erfolgspfad funktioniert weiter,
während eine kaputte Prüfung still aufhört zu prüfen.

**`markdown.security.test.ts`** parst die gerenderte Ausgabe mit einem echten
DOM und prüft, dass **kein** Element außerhalb der erlaubten Menge und
**überhaupt kein Attribut** entsteht — das ist es, was das Weglassen der
Anführungszeichen-Maskierung sicher macht. Zusätzlich wird geprüft, dass die
Nutzlast **lesbar bleibt**, damit nichts stillschweigend verschluckt wird.
⚠️ Geprüft wird gegen das **DOM, nicht gegen den String**: maskierter, inerter
Text enthält legitim `onerror=` und `javascript:` — eine Teilstring-Suche würde
dort an korrektem Code scheitern.

**`test_docs.py`** hält die Dokumentation an den Code: jede
Umgebungsvariable steht in `.env.example` **und** in `CONFIGURATION.md`, jeder
Endpunkt in `API.md`, die Version hat einen CHANGELOG-Eintrag, und die
generierten README-Blöcke haben ihre Marker. Grund: die README-Prosa behauptete
über Monate „290 Tests", während die Badges 1038 zeigten.

**`test_deps_contract.py`** hält die **zwei** Abhängigkeitslisten deckungsgleich:
`backend/pyproject.toml` (was uv und die Tests installieren) und
`backend/requirements.txt` (was das **Docker-Image** installiert). Geprüft werden
Paketmenge *und* Versionsuntergrenzen. Geschrieben nach einem echten Ausfall:
`cryptography` und `anthropic` standen nur in der `pyproject.toml`, das Image kam
ohne sie hoch, und der Fehler landete beim Import in Produktion — nachdem der
Health-Check den Container bereits getauscht hatte. Die Mutationsprobe war
derselbe Ausfall, absichtlich wiederholt.

## Zwei weitere grün-blinde Tests (Herkunft der Regel oben)

Beide stammen aus dem Ausbau der Statistik und der Optimierung und sind gute
Beispiele dafür, wie unauffällig eine wirkungslose Zusicherung aussieht:

- **Rundung je Zeit-Eimer.** Der Test seedete Werte, die alle in *einem* Eimer
  landeten — damit hielt er auch, wenn man auf „bei jedem Schritt runden"
  zurückfiel. Der ersetzende Fall ist konstruiert: 3 × 0,00005 $ ergibt gerundet
  0,0002 $, schrittweise gerundet aber 0,0003 $ — **50 % zu viel**. Erst dieser
  Fall wird bei der Mutation rot.
- **„Der Runner bekommt keinen API-Key-Job".** Das hielt auch dann, wenn die
  Claim-Abfrage *überhaupt nichts* zurückgab — also auch bei kaputter Übernahme.
  Neu werden **beide** Jobs eingereiht, und der Test verlangt, dass genau der des
  Betreibers ankommt.

## Konventionen

- **Verhalten testen, nicht Implementierung.** Die Backend-Suite spricht HTTP.
- **Gemeinsame Fixtures** in `backend/tests/conftest.py`: `client`, `auth()`,
  `make_user()`, `RUNNER_HDR`, `CAPTURE_HDR`.
- **Keine Zeitabhängigkeit.** Zeitstempel werden zurückdatiert statt gewartet.
- **Ein roter Test wird nicht „grün gemacht", bevor klar ist, wer recht hat** —
  in diesem Repo war es mehrfach der Test, der falsch lag (eine falsche Fixture,
  ein Anker, den es zweimal gab), und mehrfach der Code.
- **Zahlen in Commit-Nachrichten erst nach der Messung.**

## Was absichtlich nicht getestet wird

- **React-Komponenten** — siehe oben.
- **Die `api.ts`-Transportschicht** und die React-Hooks (reine Verdrahtung).
- **Defensive `except`-Zweige** und `__main__.py` — der Rest der fehlenden
  Prozente verteilt sich darauf.

Das ist eine Entscheidung, keine Lücke. Wer sie ändert, ändert auch die
Coverage-Messung in `scripts/update-badges.mjs` mit.
