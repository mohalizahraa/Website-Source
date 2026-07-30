"""Balanced per-segment engine routing.

Cheap/local when confident, cloud when risky. The decision uses:

* **kind** — ``sacred`` → canonical substitution; doctrinal → cloud (or
  canonical if it is a sacred quotation).
* **confidence** — a local draft below ``confidence_threshold`` (0.8) is
  escalated to a cloud engine.
* **length** — very long/complex segments go straight to cloud.

The router does not itself translate sacred segments or reuse TM exacts — those
are handled upstream in :func:`pipeline.translate.core.translate_segment`; the
router decides between the two MT tiers (local vs cloud) and reports the choice.
"""

from __future__ import annotations

from typing import List

from .types import Context, RouteDecision, Segment

# Doctrinal markers (normalised Arabic substrings). Segments touching core
# creed/theology are routed to cloud for extra care even when a local draft
# looks confident.
DOCTRINAL_MARKERS: List[str] = [
    "التوحيد",   # tawḥīd
    "الصفات",    # the divine attributes
    "الاستواء",  # istiwāʾ
    "القدر",     # divine decree
    "الايمان",   # faith (normalised)
    "الكفر",     # unbelief
    "البدعة",    # innovation
    "الشرك",     # associating partners with God
]


class Router:
    def __init__(
        self,
        *,
        confidence_threshold: float = 0.8,
        long_segment_chars: int = 600,
        source_confidence_threshold: float = 0.75,
        doctrinal_markers: List[str] | None = None,
    ):
        self.confidence_threshold = confidence_threshold
        self.long_segment_chars = long_segment_chars
        self.source_confidence_threshold = source_confidence_threshold
        self.doctrinal_markers = doctrinal_markers or DOCTRINAL_MARKERS

    # -- classification ---------------------------------------------------
    def is_doctrinal(self, seg: Segment) -> bool:
        if seg.get("doctrinal"):
            return True
        from . import arabic

        norm = arabic.normalize(seg.get("ar", ""))
        return any(arabic.normalize(m) in norm for m in self.doctrinal_markers)

    def is_long(self, seg: Segment) -> bool:
        return len(seg.get("ar", "") or "") > self.long_segment_chars

    # -- pre-translation decision ----------------------------------------
    def initial_tier(self, seg: Segment) -> RouteDecision:
        """Decide the starting engine tier before any draft is produced."""
        if seg.get("kind") == "sacred":
            return RouteDecision(
                engine="canonical", tier="canonical",
                reason="sacred segment → canonical detect-and-replace",
            )
        if self.is_doctrinal(seg):
            return RouteDecision(
                engine="cloud", tier="cloud",
                reason="doctrinal content → cloud for accuracy",
            )
        source_confidence = seg.get("confidence")
        if source_confidence is not None and float(source_confidence) < self.source_confidence_threshold:
            return RouteDecision(
                engine="cloud", tier="cloud",
                reason=(
                    f"OCR confidence ({float(source_confidence):.2f}) below "
                    f"{self.source_confidence_threshold:.2f} → cloud"
                ),
            )
        if self.is_long(seg):
            return RouteDecision(
                engine="cloud", tier="cloud",
                reason=f"long segment (> {self.long_segment_chars} chars) → cloud",
            )
        return RouteDecision(
            engine="local", tier="local",
            reason="default → local (cheap) draft",
        )

    # -- post-draft decision ---------------------------------------------
    def should_escalate(self, confidence: float) -> bool:
        """True if a local draft's confidence is below threshold."""
        return confidence < self.confidence_threshold
