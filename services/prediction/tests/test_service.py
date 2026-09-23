"""Tests for the FastAPI prediction service (predict + health + validation)."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

pytest.importorskip("fastapi")
pytest.importorskip("httpx")

from fastapi.testclient import TestClient  # noqa: E402
from inference.service import app  # noqa: E402

MODEL_STATE = {
    "intersection_id": "I2",
    "vehicle_count": 18,
    "speed": 4.2,
    "queue_length": 9,
    "density": 0.42,
    "flow_rate": 1200,
    "signal_phase": 0,
    "signal_state": "GGGgrrrrGGGgrrrr",
    "hour": 8,
    "day_of_week": 2,
    "count_lag_10s": 14,
    "count_lag_30s": 12,
}

trained = pytest.mark.skipif(
    not (Path(__file__).resolve().parents[1] / "models" / "model_metadata.json").exists(),
    reason="trained model bundle not present (run training/train.py)",
)


@pytest.fixture()
def client():
    with TestClient(app) as test_client:
        yield test_client


def test_health_reports_model_status(client):
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] in ("ready", "no_model")
    assert body["horizons_s"] == [30, 60, 90, 120]


@trained
def test_predict_returns_all_horizons(client):
    response = client.post("/predict", json=MODEL_STATE)
    assert response.status_code == 200
    body = response.json()
    assert body["intersection_id"] == "I2"
    assert set(body["predictions"].keys()) == {"30s", "60s", "90s", "120s"}
    for value in body["predictions"].values():
        assert isinstance(value, int)
        assert value >= 0
    assert body["inference_ms"] >= 0


@trained
def test_predict_deterministic_for_same_input(client):
    first = client.post("/predict", json=MODEL_STATE).json()["predictions"]
    second = client.post("/predict", json=MODEL_STATE).json()["predictions"]
    assert first == second


@trained
def test_predict_higher_queue_shifts_predictions_up(client):
    calm = dict(MODEL_STATE, vehicle_count=2, queue_length=0, density=0.05, speed=12.0, count_lag_10s=2, count_lag_30s=2)
    jammed = dict(MODEL_STATE, vehicle_count=40, queue_length=30, density=0.9, speed=0.5, count_lag_10s=38, count_lag_30s=35)
    calm_predictions = client.post("/predict", json=calm).json()["predictions"]
    jammed_predictions = client.post("/predict", json=jammed).json()["predictions"]
    assert jammed_predictions["30s"] > calm_predictions["30s"]


def test_predict_rejects_invalid_input(client):
    response = client.post("/predict", json={})
    assert response.status_code == 422
    bad = dict(MODEL_STATE, density=7.0)  # density outside [0, 1]
    response = client.post("/predict", json=bad)
    assert response.status_code == 422
    bad = dict(MODEL_STATE, hour=99)
    response = client.post("/predict", json=bad)
    assert response.status_code == 422


@trained
def test_predict_rejects_unknown_junction(client):
    bad = dict(MODEL_STATE, intersection_id="ZZ")
    response = client.post("/predict", json=bad)
    assert response.status_code == 422
    assert "Unknown intersection_id" in response.json()["detail"]
