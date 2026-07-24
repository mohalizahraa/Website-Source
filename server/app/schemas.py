"""Pydantic request/response models for the HTTP API."""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


class ReviewScores(BaseModel):
    """MQM dimension scores. All optional; reviewers may score a subset."""

    Adequacy: Optional[float] = None
    Fluency: Optional[float] = None
    Terminology: Optional[float] = None
    Footnotes: Optional[float] = None

    model_config = {"extra": "allow"}


class ReviewRequest(BaseModel):
    en_edited: str = Field(..., description="Reviewer's edited English text")
    action: Literal["approve", "reject", "skip"]
    scores: ReviewScores = Field(default_factory=ReviewScores)
    mqm: list = Field(default_factory=list, description="MQM error tags")
    reviewer: Optional[str] = None


class ReviewLearning(BaseModel):
    tm_added: int
    terms_suggested: list
    applied_to: list


class ReviewResponse(BaseModel):
    status: str
    learning: ReviewLearning


class TermbaseRequest(BaseModel):
    term_ar: str
    term_en: str
    note: Optional[str] = None
    scope: Literal["global", "book"] = "global"
    book_id: Optional[str] = None
    created_by: Optional[str] = None


class StyleRuleRequest(BaseModel):
    rule: str
    scope: Literal["global", "book"] = "global"
    book_id: Optional[str] = None


class CatalogBook(BaseModel):
    title_ar: str
    title_en: Optional[str] = None
    author: Optional[str] = None
    source_pdf: Optional[str] = None


class LearningSummary(BaseModel):
    tm_size: int
    terms: int
    rules: int
    auto_approval_rate: float
    corrections: int
