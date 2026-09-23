"""Shared feature/model constants for the ITMS prediction service.

The feature schema must stay in sync with:
- data/generate_dataset.py (dataset columns), and
- the Node.js PredictionClient (live feature assembly, apps/api).
"""

HORIZONS_S = (30, 60, 90, 120)

# Current-state features (one row per junction and time step).
STATE_FEATURES = (
    "vehicle_count",
    "avg_speed_mps",
    "queue_length",
    "density",
    "flow_rate_per_hour",
    "signal_phase",
    "signal_green_fraction",
    "cycle_position_s",
    "hour",
    "day_of_week",
    "count_lag_10s",
    "count_lag_30s",
    "count_delta_10s",
    "queue_lag_10s",
    "queue_delta_10s",
)

# Junction identity one-hot columns (generated from junction id prefix "I").
JUNCTION_PREFIX = "junction_"

MODEL_FILE = "traffic_prediction_xgb.json"
META_FILE = "model_metadata.json"
REPORT_FILE = "evaluation_report.json"

TARGET_COLUMN_PREFIX = "target_count_"


def junction_one_hot_columns(junction_ids):
    return [f"{JUNCTION_PREFIX}{j}" for j in sorted(junction_ids)]


def feature_columns(junction_ids):
    return list(STATE_FEATURES) + junction_one_hot_columns(junction_ids) + ["horizon_s"]


def target_columns():
    return [f"{TARGET_COLUMN_PREFIX}{h}" for h in HORIZONS_S]
