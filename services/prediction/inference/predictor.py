"""Model loading and single-junction prediction for the ITMS service."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from xgboost import XGBRegressor

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from schema import HORIZONS_S, META_FILE, MODEL_FILE, feature_columns  # noqa: E402


class Predictor:
    """Loads the trained model bundle and predicts all four horizons."""

    def __init__(self, models_dir: Path) -> None:
        self.models_dir = models_dir
        meta_path = models_dir / META_FILE
        if not meta_path.exists():
            raise FileNotFoundError(
                f"Model metadata not found: {meta_path}. Train the models with training/train.py first."
            )
        self.metadata: dict[str, Any] = json.loads(meta_path.read_text(encoding="utf-8"))
        self.feature_columns: list[str] = self.metadata["feature_columns"]
        self.junction_ids: list[str] = self.metadata["junction_ids"]
        self.horizons: list[int] = list(self.metadata.get("horizons_s", list(HORIZONS_S)))
        self.model_version = self.metadata.get("created_at", "unknown")

        self.models: dict[int, XGBRegressor] = {}
        for horizon in self.horizons:
            model_path = models_dir / MODEL_FILE.replace(".json", f"_h{horizon}.json")
            if not model_path.exists():
                raise FileNotFoundError(f"Model file for horizon {horizon}s not found: {model_path}")
            model = XGBRegressor()
            model.load_model(model_path)
            self.models[horizon] = model

    @property
    def is_ready(self) -> bool:
        return bool(self.models) and all(h in self.models for h in self.horizons)

    def build_features(self, state: dict[str, Any]) -> dict[str, float]:
        """Builds the model feature vector from one junction's live state.

        Expected keys (validated by the service layer):
        intersection_id, vehicle_count, speed, queue_length, density,
        flow_rate, signal_phase, signal_state, hour, day_of_week,
        and optional count_lag_10s / count_lag_30s history.
        """
        vehicle_count = float(state["vehicle_count"])
        junction_id = str(state["intersection_id"])
        if junction_id not in self.junction_ids:
            raise ValueError(f"Unknown intersection_id '{junction_id}' (known: {self.junction_ids})")

        # signal_state is the RYG string; encode deterministically as the
        # fraction of green links (same encoding used in training data).
        signal_state = str(state.get("signal_state", ""))
        green_fraction = (
            sum(1 for ch in signal_state if ch in "gG") / len(signal_state) if signal_state else 0.0
        )

        lag_10 = float(state["count_lag_10s"]) if state.get("count_lag_10s") is not None else vehicle_count
        lag_30 = float(state["count_lag_30s"]) if state.get("count_lag_30s") is not None else vehicle_count
        queue_length = float(state["queue_length"])
        queue_lag_10 = float(state["queue_lag_10s"]) if state.get("queue_lag_10s") is not None else queue_length

        features: dict[str, float] = {
            "vehicle_count": vehicle_count,
            "avg_speed_mps": float(state["speed"]),
            "queue_length": queue_length,
            "density": float(state["density"]),
            "flow_rate_per_hour": float(state["flow_rate"]),
            "signal_phase": float(state["signal_phase"]),
            "signal_green_fraction": green_fraction,
            # Position within the 90 s signal cycle; supplied by the backend
            # from simulation time (same fixed program as training data).
            "cycle_position_s": float(state.get("cycle_position_s", 0.0)),
            "hour": float(state["hour"]),
            "day_of_week": float(state["day_of_week"]),
            "count_lag_10s": lag_10,
            "count_lag_30s": lag_30,
            "count_delta_10s": vehicle_count - lag_10,
            "queue_lag_10s": queue_lag_10,
            "queue_delta_10s": queue_length - queue_lag_10,
        }
        for junction in self.junction_ids:
            features[f"junction_{junction}"] = 1.0 if junction == junction_id else 0.0
        return features

    def predict(self, state: dict[str, Any]) -> dict[int, int]:
        """Predicts vehicle counts for all horizons; returns {horizon: count}."""
        features = self.build_features(state)
        import pandas as pd

        row = pd.DataFrame([features])
        # Column order must match training exactly.
        row = row.reindex(columns=self.feature_columns, fill_value=0.0)
        predictions: dict[int, int] = {}
        for horizon, model in self.models.items():
            value = model.predict(row)[0]
            predictions[horizon] = int(round(max(0.0, float(value))))
        return predictions
