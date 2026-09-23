"""Train the ITMS traffic prediction models (XGBoost) and evaluate them.

Pipeline:
    dataset CSV (data/generate_dataset.py)
      -> feature matrix (state features + junction one-hot + horizon)
      -> run-level train/val/test split (temporal leakage safe: whole runs)
      -> one XGBoost regressor per horizon (+30/+60/+90/+120 s)
      -> evaluation on the held-out test runs (MAE, RMSE, R2, latency)
      -> model bundle + metadata + evaluation report written to disk

The report contains only measured values; nothing is invented.
"""

from __future__ import annotations

import argparse
import json
import random
import time
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from xgboost import XGBRegressor

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from schema import (  # noqa: E402
    HORIZONS_S,
    META_FILE,
    MODEL_FILE,
    REPORT_FILE,
    STATE_FEATURES,
    TARGET_COLUMN_PREFIX,
    feature_columns,
    junction_one_hot_columns,
)

MODEL_PARAMS = {
    "objective": "reg:squarederror",
    "n_estimators": 600,
    "max_depth": 8,
    "learning_rate": 0.06,
    "subsample": 0.9,
    "colsample_bytree": 0.9,
    "reg_lambda": 1.0,
    "random_state": 42,
    "n_jobs": 4,
    "tree_method": "hist",
    "verbosity": 0,
}

VAL_FRACTION = 0.15
TEST_FRACTION = 0.15
SPLIT_SEED = 42


def load_dataset(path: Path) -> pd.DataFrame:
    if not path.exists():
        raise FileNotFoundError(
            f"Dataset not found: {path}. Generate it with data/generate_dataset.py first."
        )
    frame = pd.read_csv(path)
    required = list(STATE_FEATURES) + ["run_id", "junction_id"] + [f"{TARGET_COLUMN_PREFIX}{h}" for h in HORIZONS_S]
    missing = [column for column in required if column not in frame.columns]
    if missing:
        raise ValueError(f"Dataset is missing required columns: {missing}")
    return frame


def split_runs(run_ids: list[str]) -> tuple[list[str], list[str], list[str]]:
    """Deterministic run-level split (train, val, test).

    Whole runs are assigned to one split each: rows from the same simulation
    run share autocorrelated traffic, so run-level separation is the
    temporal-leakage-safe strategy for this data.
    """
    unique = sorted(set(run_ids))
    rng = random.Random(SPLIT_SEED)
    shuffled = unique[:]
    rng.shuffle(shuffled)
    n_test = max(1, round(len(shuffled) * TEST_FRACTION))
    n_val = max(1, round(len(shuffled) * VAL_FRACTION))
    n_train = len(shuffled) - n_test - n_val
    if n_train < 1:
        raise ValueError(
            f"Not enough runs ({len(shuffled)}) for a train/val/test split; generate more scenario runs."
        )
    train = shuffled[:n_train]
    val = shuffled[n_train:n_train + n_val]
    test = shuffled[n_train + n_val:]
    return train, val, test


def build_features(frame: pd.DataFrame) -> pd.DataFrame:
    """Long-format feature matrix: one row per (sample, horizon)."""
    junction_ids = sorted(frame["junction_id"].unique())
    id_columns = junction_one_hot_columns(junction_ids)
    for junction in junction_ids:
        frame[f"{JUNCTION_COL_PREFIX}{junction}"] = (frame["junction_id"] == junction).astype(float)
    long_rows = []
    for horizon in HORIZONS_S:
        part = frame.copy()
        part["horizon_s"] = horizon
        part["target"] = frame[f"{TARGET_COLUMN_PREFIX}{horizon}"]
        long_rows.append(part)
    long = pd.concat(long_rows, ignore_index=True)
    return long

JUNCTION_COL_PREFIX = "junction_"


def train_models(dataset_path: Path, models_dir: Path, report_dir: Path) -> dict:
    frame = load_dataset(dataset_path)
    runs = frame["run_id"].unique().tolist()
    train_runs, val_runs, test_runs = split_runs(runs)
    print(f"split: {len(train_runs)} train / {len(val_runs)} val / {len(test_runs)} test runs")
    print(f"  train: {sorted(train_runs)}")
    print(f"  val:   {sorted(val_runs)}")
    print(f"  test:  {sorted(test_runs)}")

    long = build_features(frame)
    junction_ids = sorted(frame["junction_id"].unique())
    columns = feature_columns(junction_ids)

    train = long[long["run_id"].isin(train_runs)]
    val = long[long["run_id"].isin(val_runs)]
    test = long[long["run_id"].isin(test_runs)]
    print(f"rows: {len(train)} train / {len(val)} val / {len(test)} test (long format)")

    X_train, y_train = train[columns], train["target"]
    X_val, y_val = val[columns], val["target"]
    X_test, y_test = test[columns], test["target"]

    models: dict[int, XGBRegressor] = {}
    metrics: dict[str, dict] = {}
    for horizon in HORIZONS_S:
        model = XGBRegressor(**MODEL_PARAMS)
        model.fit(
            X_train,
            y_train,
            eval_set=[(X_val, y_val)],
            verbose=False,
        )
        # Per-horizon evaluation on the held-out test runs.
        test_h = test[test["horizon_s"] == horizon]
        y_test_h = test_h["target"]
        predictions_h = model.predict(test_h[columns])
        horizon_metrics = {
            "mae": float(mean_absolute_error(y_test_h, predictions_h)),
            "rmse": float(mean_squared_error(y_test_h, predictions_h) ** 0.5),
            "r2": float(r2_score(y_test_h, predictions_h)) if len(y_test_h) >= 2 else None,
            "test_rows": int(len(y_test_h)),
        }
        metrics[f"{horizon}s"] = horizon_metrics
        print(f"+{horizon}s: MAE={horizon_metrics['mae']:.3f} RMSE={horizon_metrics['rmse']:.3f} R2={horizon_metrics['r2']:.3f}")
        models[horizon] = model

    # ---- inference latency (measured, on the test rows) ----
    single = X_test.iloc[:1]
    # warmup
    for model in models.values():
        model.predict(single)
    n_calls = 2000
    started = time.perf_counter()
    for _ in range(n_calls):
        for model in models.values():
            model.predict(single)
    all_horizons_seconds = (time.perf_counter() - started) / n_calls
    started = time.perf_counter()
    for _ in range(n_calls):
        models[HORIZONS_S[0]].predict(single)
    one_horizon_seconds = (time.perf_counter() - started) / n_calls
    latency = {
        "one_horizon_ms": round(one_horizon_seconds * 1000, 4),
        "all_horizons_ms": round(all_horizons_seconds * 1000, 4),
        "measured_calls": n_calls,
    }
    print(f"latency: one horizon {latency['one_horizon_ms']} ms, all horizons {latency['all_horizons_ms']} ms")

    # ---- persist model bundle ----
    models_dir.mkdir(parents=True, exist_ok=True)
    report_dir.mkdir(parents=True, exist_ok=True)
    for horizon, model in models.items():
        model.save_model(models_dir / f"traffic_prediction_xgb_h{horizon}.json")

    dataset_sha256 = _sha256(dataset_path)
    metadata = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "algorithm": "xgboost.XGBRegressor",
        "model_files": [f"traffic_prediction_xgb_h{h}.json" for h in HORIZONS_S],
        "horizons_s": list(HORIZONS_S),
        "feature_columns": columns,
        "junction_ids": junction_ids,
        "model_params": MODEL_PARAMS,
        "dataset": {
            "path": str(dataset_path),
            "sha256": dataset_sha256,
            "rows": int(len(frame)),
            "runs_total": len(runs),
            "train_runs": sorted(train_runs),
            "val_runs": sorted(val_runs),
            "test_runs": sorted(test_runs),
        },
        "split": {"seed": SPLIT_SEED, "val_fraction": VAL_FRACTION, "test_fraction": TEST_FRACTION, "level": "run"},
        "latency": latency,
        "metrics_test": metrics,
    }
    (models_dir / META_FILE).write_text(json.dumps(metadata, indent=2), encoding="utf-8")

    report = {
        "generated_at": metadata["created_at"],
        "dataset": metadata["dataset"],
        "metrics_test": metrics,
        "latency": latency,
        "model_params": MODEL_PARAMS,
        "notes": [
            "Values are measured on held-out test runs; nothing is fabricated.",
            "Run-level split avoids temporal leakage within the dataset.",
        ],
    }
    (report_dir / REPORT_FILE).write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"model bundle: {models_dir} | report: {report_dir / REPORT_FILE}")
    return metadata


def _sha256(path: Path) -> str:
    import hashlib

    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description="Train ITMS traffic prediction models")
    parser.add_argument("--dataset", type=Path, default=None)
    parser.add_argument("--models-dir", type=Path, default=None)
    parser.add_argument("--report-dir", type=Path, default=None)
    args = parser.parse_args()

    base = Path(__file__).resolve().parents[1]
    dataset = args.dataset or (base / "data" / "training_dataset.csv")
    if not dataset.exists():
        dataset = Path(__file__).resolve().parents[2] / "data" / "traffic" / "processed" / "training_dataset.csv"
    train_models(dataset, args.models_dir or (base / "models"), args.report_dir or (base / "evaluation"))


if __name__ == "__main__":
    main()
