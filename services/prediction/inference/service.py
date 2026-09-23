"""ITMS prediction service — FastAPI application.

POST /predict: predicts junction traffic (vehicle counts) at +30/+60/+90/+120 s
from the current traffic state supplied by the Node.js backend.

GET /health: reports model availability and version.
"""

from __future__ import annotations

import sys
import time
from pathlib import Path
from typing import Any, Literal

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field, field_validator

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from schema import HORIZONS_S  # noqa: E402
from inference.predictor import Predictor  # noqa: E402

MODELS_DIR = Path(__file__).resolve().parents[1] / "models"


class PredictRequest(BaseModel):
    intersection_id: str = Field(min_length=1, max_length=32)
    vehicle_count: float = Field(ge=0, le=10000)
    speed: float = Field(ge=0, le=200)
    queue_length: float = Field(ge=0, le=10000)
    density: float = Field(ge=0, le=1)
    flow_rate: float = Field(ge=0, le=1_000_000)
    signal_phase: int = Field(ge=0, le=255)
    signal_state: str = Field(default="", max_length=256)
    cycle_position_s: float = Field(default=0.0, ge=0, le=3600)
    hour: int = Field(ge=0, le=23)
    day_of_week: int = Field(ge=0, le=6)
    count_lag_10s: float | None = Field(default=None, ge=0, le=10000)
    count_lag_30s: float | None = Field(default=None, ge=0, le=10000)
    queue_lag_10s: float | None = Field(default=None, ge=0, le=10000)

    @field_validator("intersection_id")
    @classmethod
    def validate_id(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("intersection_id must not be empty")
        return cleaned


class PredictResponse(BaseModel):
    intersection_id: str
    predictions: dict[str, int]
    model_version: str
    inference_ms: float


class HealthResponse(BaseModel):
    status: Literal["ready", "no_model"]
    model_version: str | None
    horizons_s: list[int]
    junction_ids: list[str]


app = FastAPI(title="ITMS Traffic Prediction Service", version="1.0.0")
_predictor: Predictor | None = None


def get_predictor() -> Predictor:
    global _predictor
    if _predictor is None:
        try:
            _predictor = Predictor(MODELS_DIR)
        except FileNotFoundError as err:
            raise HTTPException(status_code=503, detail=str(err))
    return _predictor


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    try:
        predictor = get_predictor()
    except HTTPException:
        return HealthResponse(status="no_model", model_version=None, horizons_s=list(HORIZONS_S), junction_ids=[])
    return HealthResponse(
        status="ready",
        model_version=predictor.model_version,
        horizons_s=predictor.horizons,
        junction_ids=predictor.junction_ids,
    )


@app.post("/predict", response_model=PredictResponse)
def predict(request: PredictRequest) -> PredictResponse:
    predictor = get_predictor()
    state: dict[str, Any] = request.model_dump()
    started = time.perf_counter()
    try:
        predictions = predictor.predict(state)
    except ValueError as err:
        raise HTTPException(status_code=422, detail=str(err))
    inference_ms = (time.perf_counter() - started) * 1000
    return PredictResponse(
        intersection_id=request.intersection_id,
        predictions={f"{horizon}s": count for horizon, count in predictions.items()},
        model_version=predictor.model_version,
        inference_ms=round(inference_ms, 4),
    )
