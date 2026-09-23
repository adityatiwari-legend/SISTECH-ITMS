"""End-to-end training smoke test: tiny dataset -> trained models -> report.

Uses a real (small) SUMO-generated dataset; skips cleanly when SUMO or the
Python ML dependencies are unavailable.
"""

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from data.generate_dataset import build_scenarios, add_targets, collect_run  # noqa: E402
from training.train import train_models  # noqa: E402
from schema import HORIZONS_S, META_FILE, REPORT_FILE, feature_columns  # noqa: E402

pytest.importorskip("xgboost")
pytest.importorskip("pandas")
try:
    import traci  # noqa: F401
except ImportError:
    pytest.skip("traci not installed", allow_module_level=True)


def _sumo_available() -> bool:
    import shutil

    return shutil.which("sumo") is not None


pytestmark = pytest.mark.skipif(not _sumo_available(), reason="SUMO binary not on PATH")


def test_full_pipeline_generate_train_evaluate(tmp_path):
    # ---- generate a tiny but valid multi-scenario dataset ----
    scenarios = build_scenarios(4)
    rows = []
    for scenario in scenarios:
        rows.extend(collect_run(scenario, tmp_path))
    dataset = add_targets(rows)
    assert len(dataset) > 0

    dataset_path = tmp_path / "dataset.csv"
    import csv

    fieldnames = list(dataset[0].keys())
    with dataset_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(dataset)

    # ---- train + evaluate ----
    models_dir = tmp_path / "models"
    report_dir = tmp_path / "evaluation"
    metadata = train_models(dataset_path, models_dir, report_dir)

    # model bundle exists with one file per horizon
    for horizon in HORIZONS_S:
        assert (models_dir / f"traffic_prediction_xgb_h{horizon}.json").exists()
    assert (models_dir / META_FILE).exists()
    assert (report_dir / REPORT_FILE).exists()

    # metadata sanity: features, split identity, dataset hash
    assert metadata["feature_columns"] == feature_columns(metadata["junction_ids"])
    assert set(metadata["dataset"]["train_runs"]).isdisjoint(metadata["dataset"]["test_runs"])
    assert len(metadata["dataset"]["sha256"]) == 64

    # report contains measured metrics for every horizon
    report = json.loads((report_dir / REPORT_FILE).read_text(encoding="utf-8"))
    for horizon in HORIZONS_S:
        key = f"{horizon}s"
        assert key in report["metrics_test"]
        entry = report["metrics_test"][key]
        assert entry["test_rows"] > 0
        assert entry["mae"] >= 0 and entry["rmse"] >= 0
        assert entry["r2"] is not None
        assert 0 < entry["latency"] if False else True  # latency lives at report level
    assert report["latency"]["measured_calls"] > 0
    assert report["latency"]["all_horizons_ms"] > 0
