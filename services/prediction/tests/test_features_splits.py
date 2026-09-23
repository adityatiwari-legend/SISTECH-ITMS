"""Tests for feature building and run-level splitting."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from schema import HORIZONS_S, TARGET_COLUMN_PREFIX, feature_columns  # noqa: E402
from training.train import build_features, load_dataset, split_runs  # noqa: E402


def make_frame(run_ids, junctions=("I1", "I2"), rows_per_run=8):
    import pandas as pd

    rows = []
    for run_id in run_ids:
        for index in range(rows_per_run):
            for junction in junctions:
                rows.append(
                    {
                        "run_id": run_id,
                        "sim_time_s": index * 2.0,
                        "junction_id": junction,
                        "vehicle_count": float(index),
                        "avg_speed_mps": 10.0,
                        "queue_length": 0.0,
                        "density": 0.1,
                        "flow_rate_per_hour": 100.0,
                        "signal_phase": 0,
                        "signal_green_fraction": 0.5,
                        "cycle_position_s": float(index * 2 % 90),
                        "hour": 8,
                        "day_of_week": 2,
                        "count_lag_10s": float(max(0, index - 5)),
                        "count_lag_30s": 0.0,
                        "count_delta_10s": float(index - max(0, index - 5)),
                        "queue_lag_10s": 0.0,
                        "queue_delta_10s": 0.0,
                        **{f"{TARGET_COLUMN_PREFIX}{h}": float(index + h / 30) for h in HORIZONS_S},
                    }
                )
    return pd.DataFrame(rows)


def test_split_runs_is_deterministic_and_disjoint():
    run_ids = [f"r{i:02d}" for i in range(12)]
    train1, val1, test1 = split_runs(run_ids)
    train2, val2, test2 = split_runs(run_ids)
    assert train1 == train2 and val1 == val2 and test1 == test2
    assert set(train1) | set(val1) | set(test1) == set(run_ids)
    assert not (set(train1) & set(val1))
    assert not (set(train1) & set(test1))
    assert not (set(val1) & set(test1))


def test_split_runs_proportions():
    train, val, test = split_runs([f"r{i:02d}" for i in range(20)])
    assert len(train) == 14  # 70%
    assert len(val) == 3  # 15%
    assert len(test) == 3  # 15%


def test_split_runs_requires_enough_data():
    with pytest.raises(ValueError):
        split_runs(["r00"])


def test_build_features_long_format():
    frame = make_frame(["r00", "r01"])
    long = build_features(frame)
    # one row per (sample, horizon)
    assert len(long) == len(frame) * len(HORIZONS_S)
    assert set(long["horizon_s"].unique()) == set(HORIZONS_S)
    # junction one-hot columns present
    for column in feature_columns(["I1", "I2"]):
        assert column in long.columns
    # one-hot correctness
    sample = long[(long["junction_id"] == "I1") & (long["horizon_s"] == 30)].iloc[0]
    assert sample["junction_I1"] == 1.0
    assert sample["junction_I2"] == 0.0
    # target matches the horizon column value
    row = frame[(frame["junction_id"] == "I1") & (frame["sim_time_s"] == 0.0)].iloc[0]
    built = long[(long["junction_id"] == "I1") & (long["sim_time_s"] == 0.0) & (long["horizon_s"] == 30)].iloc[0]
    assert built["target"] == row[f"{TARGET_COLUMN_PREFIX}30"]


def test_load_dataset_rejects_missing_columns(tmp_path):
    import pandas as pd

    path = tmp_path / "bad.csv"
    pd.DataFrame({"run_id": [], "junction_id": []}).to_csv(path, index=False)
    with pytest.raises(ValueError):
        load_dataset(path)
    with pytest.raises(FileNotFoundError):
        load_dataset(tmp_path / "nope.csv")
