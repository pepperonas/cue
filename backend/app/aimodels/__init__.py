"""Zentraler Modell-Katalog — Aufbau wie `app.tags`.

Router spricht HTTP, `service` kennt die Regeln, `repository` kennt SQL,
`catalog` trägt die recherchierten Anbieter und Start-Modelle.
"""
from .service import AiModelError, AiModelService

__all__ = ["AiModelError", "AiModelService"]
