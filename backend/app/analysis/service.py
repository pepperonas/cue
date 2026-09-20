"""Regeln der Projekt-Analyse: anstoßen, ausführen lassen, übernehmen.

Schichtung wie bei der Optimierung — Router spricht HTTP, dieser Dienst kennt
die Regeln, das Repository kennt SQL. Was hier NICHT passiert, ist so wichtig
wie das, was passiert:

* **Zusammenführen** läuft über den bestehenden `MergeDialog` und damit über
  `POST /prompts/merge`. Damit erbt es die Rückabwicklung aus 0.68.0.
* **Archivieren** eines redundanten Prompts läuft über das bestehende
  `PATCH /prompts/{id}`. Damit erbt es jede Statusregel (tested wird geräumt,
  blockiert wird geprüft).

Übrig bleibt genau EIN neuer Schreibpfad: die Reihenfolge. Das ist Absicht —
drei neue Wege für drei Aktionen wären drei Stellen, an denen die Regeln
auseinanderlaufen können.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlmodel import Session, select

from .. import changes
from ..config import get_settings
from ..models import (
    OptimizationDecision,
    OptimizationStatus,
    Project,
    Prompt,
    PromptPriority,
    PromptStatus,
    ProjectAnalysis,
)
from ..optimization import providers
from ..optimization.service import OptimizationError
from . import schema
from .meta_prompt import ANALYSIS_PROMPT_VERSION, MAX_ERLEDIGTE, OffenerPrompt, build_analysis_prompt

log = logging.getLogger("cue.analysis")

#: Unter zwei offenen Prompts gibt es keine Reihenfolge zu finden.
MIN_PROMPTS = 2


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


@dataclass(frozen=True)
class AnalyseJob:
    """Was ein Ausführer braucht — keine Datenbankobjekte verlassen den Dienst."""

    id: int
    provider: str
    model: str
    prompt: str
    timeout_s: int
    max_chars: int
    max_retries: int
    project_name: str


class ProjectAnalysisService:
    def __init__(self, session: Session) -> None:
        self.session = session
        self.settings = get_settings()

    # ------------------------------------------------------------- anstoßen

    def queue(self, user_id: int, project_id: int | None, *, provider: str) -> ProjectAnalysis:
        if not self.settings.optimize_enabled:
            raise OptimizationError("Die KI-Funktionen sind abgeschaltet", 503)

        projekt = None
        if project_id is not None:
            projekt = self.session.get(Project, project_id)
            if projekt is None or projekt.user_id != user_id:
                raise OptimizationError("Projekt nicht gefunden", 404)

        offen = self._offene(user_id, project_id)
        if len(offen) < MIN_PROMPTS:
            raise OptimizationError(
                f"Für eine Analyse braucht es mindestens {MIN_PROMPTS} offene Prompts "
                f"in diesem Projekt (gefunden: {len(offen)})",
                400,
            )
        laufend = self._laufender(user_id, project_id)
        if laufend is not None:
            raise OptimizationError("Für dieses Projekt läuft bereits eine Analyse", 409)

        name = projekt.name if projekt else "Ohne Projekt"
        prompt = build_analysis_prompt(
            projekt=name,
            offene=[
                OffenerPrompt(
                    id=p.id,
                    titel=p.title,
                    body=p.body,
                    tags=p.tags or "",
                    prioritaet=_prio(p),
                    blockiert=bool(p.blocked),
                )
                for p in offen
            ],
            erledigte_titel=self._erledigte_titel(user_id, project_id),
        )
        lauf = ProjectAnalysis(
            user_id=user_id,
            project_id=project_id,
            project_name=name,
            provider=provider,
            model=self.settings.optimize_model or "",
            prompt_version=ANALYSIS_PROMPT_VERSION,
            prompt_text=prompt,
            subject_ids=json.dumps([p.id for p in offen]),
            cursor=changes.cursor_for(self.session, user_id),
        )
        self.session.add(lauf)
        self.session.commit()
        self.session.refresh(lauf)
        log.info(
            "analysis queued id=%s project=%s prompts=%s provider=%s",
            lauf.id,
            project_id,
            len(offen),
            provider,
        )
        return lauf

    def _offene(self, user_id: int, project_id: int | None) -> list[Prompt]:
        """Die offenen Prompts des Projekts in BOARD-Reihenfolge.

        Board-Reihenfolge, nicht Einfügereihenfolge: sie ist die
        Rückfallposition für alles, was die KI nicht einordnet, und der Platz,
        auf den die neue Folge später verteilt wird.
        """
        from ..ordering import display_key

        stmt = select(Prompt).where(
            Prompt.user_id == user_id,
            Prompt.status == PromptStatus.queued,
        )
        if project_id is None:
            stmt = stmt.where(Prompt.project_id.is_(None))
        else:
            stmt = stmt.where(Prompt.project_id == project_id)
        return sorted(self.session.exec(stmt).all(), key=display_key)

    def _erledigte_titel(self, user_id: int, project_id: int | None) -> list[str]:
        stmt = select(Prompt).where(
            Prompt.user_id == user_id,
            Prompt.status == PromptStatus.done,
        )
        if project_id is None:
            stmt = stmt.where(Prompt.project_id.is_(None))
        else:
            stmt = stmt.where(Prompt.project_id == project_id)
        rows = self.session.exec(stmt.order_by(Prompt.id.desc()).limit(MAX_ERLEDIGTE)).all()
        return [r.title for r in rows if r.title]

    def _laufender(self, user_id: int, project_id: int | None) -> ProjectAnalysis | None:
        stmt = select(ProjectAnalysis).where(
            ProjectAnalysis.user_id == user_id,
            ProjectAnalysis.status.in_(
                [OptimizationStatus.queued, OptimizationStatus.running]
            ),
        )
        if project_id is None:
            stmt = stmt.where(ProjectAnalysis.project_id.is_(None))
        else:
            stmt = stmt.where(ProjectAnalysis.project_id == project_id)
        return self.session.exec(stmt).first()

    # -------------------------------------------------------------- lesen

    def get(self, user_id: int, analysis_id: int) -> ProjectAnalysis:
        lauf = self.session.get(ProjectAnalysis, analysis_id)
        # 404 statt 403 für fremde Zeilen — „verboten" würde bestätigen, dass
        # die Zeile existiert (Hausregel, s. test_tenancy.py).
        if lauf is None or lauf.user_id != user_id:
            raise OptimizationError("Analyse nicht gefunden", 404)
        return lauf

    def list(self, user_id: int, project_id: int | None = None, limit: int = 20) -> list:
        stmt = select(ProjectAnalysis).where(ProjectAnalysis.user_id == user_id)
        if project_id is not None:
            stmt = stmt.where(ProjectAnalysis.project_id == project_id)
        return self.session.exec(
            stmt.order_by(ProjectAnalysis.created_at.desc()).limit(limit)
        ).all()

    def aktive(self, user_id: int) -> list:
        return self.session.exec(
            select(ProjectAnalysis).where(
                ProjectAnalysis.user_id == user_id,
                ProjectAnalysis.status.in_(
                    [OptimizationStatus.queued, OptimizationStatus.running]
                ),
            )
        ).all()

    def veraltet(self, lauf: ProjectAnalysis) -> bool:
        """Hat sich seit dem Lauf etwas an den Daten geändert?

        Der Vorschlag nennt Positionen für einen Stand, den es vielleicht nicht
        mehr gibt. Sagen ist besser als stillschweigend falsch übernehmen.
        """
        if not lauf.cursor or lauf.user_id is None:
            return False
        jetzt = changes.fingerprint(self.session, lauf.user_id)
        return bool(changes.changed(changes.decode(lauf.cursor), jetzt))

    def ergebnis(self, lauf: ProjectAnalysis) -> schema.Analyse | None:
        if not lauf.result_json:
            return None
        try:
            return schema.normalisiere(
                json.loads(lauf.result_json), bekannt=self._bekannt(lauf)
            )
        except (ValueError, TypeError):
            return None

    def _bekannt(self, lauf: ProjectAnalysis) -> dict[int, str]:
        """Die IDs, die in den Lauf gingen — in genau ihrer Reihenfolge."""
        try:
            ids = [int(i) for i in json.loads(lauf.subject_ids or "[]")]
        except (ValueError, TypeError):
            ids = []
        gefunden: dict[int, str] = {}
        for pid in ids:
            prompt = self.session.get(Prompt, pid)
            # Seit dem Lauf gelöschte Prompts fallen raus — ein Vorschlag darf
            # keine Zeile anbieten, die es nicht mehr gibt.
            if prompt is not None and prompt.user_id == lauf.user_id:
                gefunden[pid] = prompt.title
        return gefunden

    # ------------------------------------------------------------ ausführen

    def claim(self, runner_id: str, provider_ids: list[str] | None = None) -> AnalyseJob | None:
        erlaubt = provider_ids if provider_ids is not None else providers.runner_ids()
        lauf = self.session.exec(
            select(ProjectAnalysis)
            .where(
                ProjectAnalysis.status == OptimizationStatus.queued,
                ProjectAnalysis.provider.in_(erlaubt),
            )
            .order_by(ProjectAnalysis.created_at)
            .limit(1)
        ).first()
        if lauf is None:
            return None
        lauf.status = OptimizationStatus.running
        lauf.started_at = utcnow()
        lauf.runner_id = runner_id
        self.session.add(lauf)
        self.session.commit()
        self.session.refresh(lauf)
        log.info("analysis claimed id=%s by=%s", lauf.id, runner_id)
        return AnalyseJob(
            id=lauf.id,
            provider=lauf.provider,
            model=lauf.model,
            prompt=lauf.prompt_text,
            timeout_s=self.settings.optimize_timeout,
            # Die Analyse ist absichtlich NICHT an OPTIMIZE_MAX_CHARS gebunden:
            # das ist die Grenze für EINEN Prompt, hier reist ein ganzes Projekt.
            max_chars=len(lauf.prompt_text) + 1,
            max_retries=self.settings.optimize_max_retries,
            project_name=lauf.project_name,
        )

    def complete(self, analysis_id: int, result) -> ProjectAnalysis:  # noqa: ANN001
        """Ergebnis eines Ausführers annehmen, auswerten und ablegen."""
        lauf = self.session.get(ProjectAnalysis, analysis_id)
        if lauf is None:
            raise OptimizationError("Analyse nicht gefunden", 404)
        if lauf.status != OptimizationStatus.running:
            raise OptimizationError("Diese Analyse läuft nicht", 409)

        lauf.exit_code = result.exit_code
        lauf.duration_ms = result.duration_ms
        lauf.cost_usd = result.cost_usd
        lauf.input_tokens = result.input_tokens
        lauf.output_tokens = result.output_tokens
        if result.model:
            lauf.model = result.model
        lauf.finished_at = utcnow()

        if result.status != "succeeded":
            lauf.status = OptimizationStatus.failed
            lauf.error = (result.error or "Unbekannter Fehler")[:800]
        else:
            roh = result.optimized_text or ""
            # Die rohe Antwort bleibt gekappt liegen: bei einem Auswertefehler
            # ist sie die einzige Spur, und ohne sie wäre der bezahlte Lauf
            # nicht nachvollziehbar.
            lauf.raw_text = roh[:20000]
            try:
                daten = schema.extrahiere_json(roh)
                analyse = schema.normalisiere(daten, bekannt=self._bekannt(lauf))
            except schema.AnalyseFehler as exc:
                lauf.status = OptimizationStatus.failed
                lauf.error = f"Antwort nicht auswertbar: {exc}"[:800]
            else:
                if analyse.leer():
                    lauf.status = OptimizationStatus.failed
                    lauf.error = "Die Antwort enthielt keinen verwertbaren Vorschlag"
                else:
                    lauf.status = OptimizationStatus.succeeded
                    lauf.result_json = json.dumps(
                        schema.als_dict(analyse), ensure_ascii=False
                    )
        self.session.add(lauf)
        self.session.commit()
        self.session.refresh(lauf)
        log.info("analysis finished id=%s status=%s", lauf.id, lauf.status.value)
        return lauf

    def cancel(self, user_id: int, analysis_id: int) -> ProjectAnalysis:
        lauf = self.get(user_id, analysis_id)
        if lauf.status not in (OptimizationStatus.queued, OptimizationStatus.running):
            raise OptimizationError("Diese Analyse läuft nicht mehr", 409)
        lauf.status = OptimizationStatus.canceled
        lauf.finished_at = utcnow()
        self.session.add(lauf)
        self.session.commit()
        self.session.refresh(lauf)
        return lauf

    def reap_stale(self) -> int:
        """Läufe aufräumen, deren Ausführer nie zurückkam."""
        grenze = utcnow() - timedelta(
            seconds=self.settings.optimize_timeout + self.settings.optimize_stale_grace
        )
        offen = self.session.exec(
            select(ProjectAnalysis).where(
                ProjectAnalysis.status == OptimizationStatus.running
            )
        ).all()
        getroffen = 0
        for lauf in offen:
            start = lauf.started_at
            if start is not None and start.tzinfo is None:
                start = start.replace(tzinfo=timezone.utc)
            if start is None or start < grenze:
                lauf.status = OptimizationStatus.failed
                lauf.error = "Kein Ergebnis — der Ausführer hat sich nicht zurückgemeldet"
                lauf.finished_at = utcnow()
                self.session.add(lauf)
                getroffen += 1
        if getroffen:
            self.session.commit()
        return getroffen

    # ------------------------------------------------------------ übernehmen

    def decide(self, user_id: int, analysis_id: int, *, apply: bool) -> tuple[ProjectAnalysis, int]:
        """Vorschlag übernehmen oder verwerfen. Gibt die Zahl der Änderungen zurück."""
        lauf = self.get(user_id, analysis_id)
        if lauf.status != OptimizationStatus.succeeded:
            raise OptimizationError("Diese Analyse hat kein Ergebnis", 409)
        if lauf.decision != OptimizationDecision.pending:
            raise OptimizationError("Über diese Analyse wurde bereits entschieden", 409)

        geaendert = 0
        if apply:
            analyse = self.ergebnis(lauf)
            if analyse is None:
                raise OptimizationError("Das Ergebnis ist nicht lesbar", 409)
            geaendert = self._reihenfolge_anwenden(lauf, analyse)
        lauf.decision = (
            OptimizationDecision.applied if apply else OptimizationDecision.discarded
        )
        lauf.decided_at = utcnow()
        self.session.add(lauf)
        self.session.commit()
        self.session.refresh(lauf)
        return lauf, geaendert

    def _reihenfolge_anwenden(self, lauf: ProjectAnalysis, analyse: schema.Analyse) -> int:
        """Die vorgeschlagene Folge schreiben — und NUR die Plätze dieses Projekts.

        ⚠️ `sort_order` ist pro STATUS-SPALTE vergeben, nicht pro Projekt. Die
        Queue eines Projekts 1..n durchzunummerieren war exakt der Fehler von
        0.27.0: es überschreibt die Reihenfolge aller anderen Projekte in
        derselben Spalte. Deshalb werden hier die Prompts auf die Plätze
        verteilt, die sie **bereits belegen** — dieselbe Lösung wie
        `withReorderedTail` bei den Projekt-Chips: der Rest der Spalte bleibt
        unangetastet, weil keine einzige fremde Zeile beschrieben wird.
        """
        prompts = {p.id: p for p in self._offene(lauf.user_id, lauf.project_id)}
        folge = [s for s in analyse.reihenfolge if s.prompt_id in prompts]
        if not folge:
            return 0

        # Die Plätze, die dieses Projekt in der Spalte hält.
        plaetze = sorted(prompts[s.prompt_id].sort_order for s in folge)

        geaendert = 0
        for platz, schritt in zip(plaetze, folge):
            prompt = prompts[schritt.prompt_id]
            if prompt.sort_order != platz:
                prompt.sort_order = platz
                geaendert += 1
            if schritt.prioritaet and schritt.prioritaet in schema.PRIORITAETEN:
                neu = PromptPriority(schritt.prioritaet)
                if prompt.priority != neu:
                    prompt.priority = neu
                    # Eine Priorität IST eine Feldänderung und muss auf den
                    # anderen Geräten ankommen; ein reines Umsortieren nicht —
                    # genau wie `_renumber` die Nachbarn nicht anfasst.
                    prompt.updated_at = utcnow()
                    geaendert += 1
            self.session.add(prompt)
        self.session.commit()
        return geaendert


def _prio(prompt: Prompt) -> str:
    wert = getattr(prompt.priority, "value", prompt.priority)
    return str(wert or "normal")
