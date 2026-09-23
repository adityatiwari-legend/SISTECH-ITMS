"""Generate the ITMS traffic prediction dataset from SUMO runs.

Runs multiple deterministic scenarios (varying vehicle demand, route mix,
demand period, duration and signal disturbances) against the ITMS SUMO
network through TraCI and writes a wide CSV dataset:

    one row per (run, junction, sim_time) with current-state features and
    future vehicle counts at +30/+60/+90/+120 s as targets.

Everything in the dataset is measured from the simulation; nothing is
fabricated. Rows whose horizon extends past the end of a run are dropped
(no partial targets).

Usage:
    python -m data.generate_dataset --runs 16 --out ../data
"""

from __future__ import annotations

import argparse
import csv
import random
import socket
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path

import traci  # type: ignore

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from schema import HORIZONS_S, TARGET_COLUMN_PREFIX  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[3]
NETWORK = REPO_ROOT / "simulation" / "sumo" / "network" / "itms.net.xml"
BASELINE_ROU = REPO_ROOT / "simulation" / "sumo" / "scenarios" / "baseline" / "baseline.rou.xml"

COLLECT_EVERY_S = 2
STEP_LENGTH_S = 1

# Fixed-time program geometry of the ITMS network (see itms.net.xml):
# G 42s, y 3s, G 42s, y 3s => 90 s cycle.
CYCLE_S = 90
GREEN_PHASES = (0, 2)
YELLOW_PHASES = (1, 3)

# Corridor route definitions (from the ITMS baseline scenario).
ROUTE_EDGES = (
    ("r_east_row1", "w1_i1 i1_i2 i2_i3 i3_e1"),
    ("r_west_row1", "e1_i3 i3_i2 i2_i1 i1_w1"),
    ("r_east_row2", "w2_i4 i4_i5 i5_i6 i6_e2"),
    ("r_west_row2", "e2_i6 i6_i5 i5_i4 i4_w2"),
    ("r_north_center", "s2_i2 i2_i5 i5_n2"),
    ("r_south_center", "n2_i5 i5_i2 i2_s2"),
    ("r_north_left", "s1_i1 i1_i4 i4_n1"),
    ("r_south_left", "n1_i4 i4_i1 i1_s1"),
    ("r_north_right", "s3_i3 i3_i6 i6_n3"),
    ("r_south_right", "n3_i6 i6_i3 i3_s3"),
    ("r_turn_diag_1", "s1_i1 i1_i2 i2_i5 i5_i6 i6_n3"),
    ("r_turn_diag_2", "e1_i3 i3_i2 i2_i1 i1_i4 i4_w2"),
)


@dataclass
class Scenario:
    run_id: str
    seed: int
    duration_s: int
    demand_multiplier: float
    route_mix: str  # "a" or "b"
    start_hour: int
    day_of_week: int
    # Incident: junction forced to all-red for [begin, end) sim seconds.
    incident_junction: str | None
    incident_begin_s: int
    incident_end_s: int


def build_scenarios(runs: int) -> list[Scenario]:
    """Deterministic scenario plan (seeded; no randomness at collect time)."""
    scenarios: list[Scenario] = []
    hours = (7, 8, 12, 14, 17, 18, 20, 22)
    junctions = ["I1", "I2", "I3", "I4", "I5", "I6"]
    for index in range(runs):
        rng = random.Random(1000 + index)
        duration = 360 + 30 * (index % 5)  # 360..480 s, deterministic variety
        # Continuous demand coverage in [0.3, 2.2], quantized to 0.05.
        demand = round((0.3 + rng.random() * 1.9) * 20) / 20
        incidents = index % 2 == 0  # half of the runs have a signal incident
        junction = junctions[rng.randrange(len(junctions))] if incidents else None
        begin = 100 + 30 * (index % 5)
        incident_duration = 40 + 10 * (index % 5)
        scenarios.append(
            Scenario(
                run_id=f"gen{index:02d}",
                seed=500 + index,
                duration_s=duration,
                demand_multiplier=demand,
                route_mix="a" if index % 2 == 0 else "b",
                start_hour=hours[index % len(hours)],
                day_of_week=index % 7,
                incident_junction=junction,
                incident_begin_s=begin,
                incident_end_s=begin + incident_duration,
            )
        )
    return scenarios


def write_route_file(scenario: Scenario, path: Path) -> None:
    """Writes a route file with the scenario's demand and route mix.

    Base flows come from the baseline route file; per-flow demand is scaled
    by the scenario multiplier, and the route mix redistributes share
    between the two directions of each corridor deterministically.
    """
    base_flows = [
        ("f_east_row1", "r_east_row1", "car", 600),
        ("f_west_row1", "r_west_row1", "car", 500),
        ("f_bus_row1", "r_east_row1", "bus", 30),
        ("f_east_row2", "r_east_row2", "car", 400),
        ("f_west_row2", "r_west_row2", "car", 400),
        ("f_truck_row2", "r_west_row2", "truck", 20),
        ("f_north_center", "r_north_center", "car", 500),
        ("f_south_center", "r_south_center", "car", 500),
        ("f_north_left", "r_north_left", "car", 200),
        ("f_south_left", "r_south_left", "car", 150),
        ("f_north_right", "r_north_right", "car", 200),
        ("f_south_right", "r_south_right", "car", 150),
        ("f_turn_diag_1", "r_turn_diag_1", "car", 100),
        ("f_turn_diag_2", "r_turn_diag_2", "car", 80),
    ]
    mix_boost_west = 1.25 if scenario.route_mix == "b" else 1.0
    mix_boost_east = 0.8 if scenario.route_mix == "b" else 1.0

    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        "<routes>",
        '    <vType id="car" vClass="passenger" length="5.0" accel="2.6" decel="4.5" departLane="best"/>',
        '    <vType id="bus" vClass="bus" length="12.0" accel="1.0" decel="3.5" departLane="best"/>',
        '    <vType id="truck" vClass="truck" length="9.0" accel="1.3" decel="3.5" departLane="best"/>',
    ]
    for route_id, edges in ROUTE_EDGES:
        lines.append(f'    <route id="{route_id}" edges="{edges}"/>')
    for flow_id, route_id, vtype, vehs_per_hour in base_flows:
        demand = vehs_per_hour * scenario.demand_multiplier
        if "west" in flow_id or "w2" in flow_id:
            demand *= mix_boost_west
        if "east" in flow_id or "e2" in flow_id:
            demand *= mix_boost_east
        lines.append(
            f'    <flow id="{flow_id}" type="{vtype}" route="{route_id}" begin="0" '
            f'end="{scenario.duration_s}" vehsPerHour="{max(1, round(demand))}"/>'
        )
    lines.append("</routes>")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def phase_index_at(sim_time: float) -> int:
    """Index of the fixed program's phase at the given sim time."""
    position = sim_time % CYCLE_S
    if position < 42:
        return 0
    if position < 45:
        return 1
    if position < 87:
        return 2
    return 3


def collect_run(scenario: Scenario, workdir: Path) -> list[dict]:
    """Runs one SUMO scenario and returns collected feature rows."""
    route_path = workdir / f"{scenario.run_id}.rou.xml"
    write_route_file(scenario, route_path)
    port = free_port()
    cmd = [
        "sumo",
        "-n", str(NETWORK),
        "-r", str(route_path),
        "--begin", "0",
        "--end", str(scenario.duration_s),
        "--step-length", str(STEP_LENGTH_S),
        "--remote-port", str(port),
        "--no-step-log", "true",
        "--seed", str(scenario.seed),
    ]
    process = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    try:
        connection = traci.connect(port, numRetries=20, host="127.0.0.1")
    except Exception:
        process.kill()
        stderr_tail = ""
        try:
            process.wait(timeout=5)
            stderr_tail = (process.stderr.read() or b"").decode("utf8", "replace")[-800:]
        except Exception:
            pass
        raise RuntimeError(f"Could not connect TraCI for run {scenario.run_id}: {stderr_tail}")

    junctions = ["I1", "I2", "I3", "I4", "I5", "I6"]
    # Approach edges per junction (edges whose toJunction is the junction),
    # from the ITMS network topology.
    approaches: dict[str, list[str]] = {}
    edges_by_to: dict[str, list[str]] = {}
    for edge in connection.edge.getIDList():
        if edge.startswith(":"):
            continue
        # SUMO edge domain lacks getFromJunction here; derive from the id
        # convention "a_b" used by this network.
        parts = edge.split("_")
        if len(parts) == 2 and parts[1].upper() in junctions:
            edges_by_to.setdefault(parts[1].upper(), []).append(edge)
    for junction in junctions:
        approaches[junction] = sorted(edges_by_to.get(junction, []))
    edge_to_junction = {edge: junction for junction, edges in approaches.items() for edge in edges}

    def approach_junction_of(edge: str) -> str:
        return edge_to_junction[edge]

    rows: list[dict] = []
    history: dict[str, list[tuple[float, int]]] = {junction: [] for junction in junctions}
    queue_history: dict[str, list[tuple[float, int]]] = {junction: [] for junction in junctions}
    sim_time = 0.0

    # Subscribe all approach edges once: after every step the results for
    # count/halting/speed/occupancy/vehicle-id-list are delivered with the
    # step response (no per-variable round trips). The id list powers the
    # flow measurement (departures per interval).
    all_edges = sorted({edge for junction in junctions for edge in approaches[junction]})
    for edge in all_edges:
        connection.edge.subscribe(
            edge,
            (
                traci.constants.LAST_STEP_VEHICLE_NUMBER,
                traci.constants.LAST_STEP_VEHICLE_HALTING_NUMBER,
                traci.constants.LAST_STEP_MEAN_SPEED,
                traci.constants.LAST_STEP_OCCUPANCY,
                traci.constants.LAST_STEP_VEHICLE_ID_LIST,
            ),
        )

    last_ids: dict[str, set[str]] = {}
    last_flow_tick: float | None = None
    try:
        while sim_time < scenario.duration_s:
            connection.simulation.step()
            sim_time = connection.simulation.getTime()

            incident_active = (
                scenario.incident_junction is not None
                and scenario.incident_begin_s <= sim_time < scenario.incident_end_s
            )
            if incident_active and scenario.incident_junction is not None:
                connection.trafficlight.setRedYellowGreenState(
                    scenario.incident_junction, "r" * 16
                )

            subscription = connection.edge.getAllSubscriptionResults() or {}

            if (round(sim_time) % COLLECT_EVERY_S) != 0:
                continue

            # Flow: vehicles that departed their approach edge during the
            # last interval (id turnover), summed per junction, scaled to
            # vehicles/hour. This measures junction outflow.
            departed_per_junction: dict[str, int] = {junction: 0 for junction in junctions}
            interval_for_flow = sim_time - last_flow_tick if last_flow_tick is not None else 0.0
            for edge in all_edges:
                current_ids = set(subscription.get(edge, {}).get(traci.constants.LAST_STEP_VEHICLE_ID_LIST, ()))
                previous = last_ids.get(edge)
                if previous is not None and interval_for_flow > 0:
                    departed_per_junction[approach_junction_of(edge)] += len(previous - current_ids)
                last_ids[edge] = current_ids
            last_flow_tick = sim_time

            signal_states = {
                junction: connection.trafficlight.getRedYellowGreenState(junction)
                for junction in junctions
            }
            for junction in junctions:
                counts, haltings, speeds, occupancies = [], [], [], []
                for edge in approaches[junction]:
                    entry = subscription.get(edge, {})
                    counts.append(entry.get(traci.constants.LAST_STEP_VEHICLE_NUMBER, 0))
                    haltings.append(entry.get(traci.constants.LAST_STEP_VEHICLE_HALTING_NUMBER, 0))
                    speeds.append(entry.get(traci.constants.LAST_STEP_MEAN_SPEED, 0.0))
                    occupancies.append(entry.get(traci.constants.LAST_STEP_OCCUPANCY, 0.0))
                vehicle_count = float(sum(counts))
                queue_length = float(sum(haltings))
                occupied_speeds = [
                    speed
                    for speed, count in zip(speeds, counts)
                    if count > 0
                ]
                avg_speed = sum(occupied_speeds) / len(occupied_speeds) if occupied_speeds else 0.0
                density = sum(occupancies) / len(occupancies) if occupancies else 0.0
                flow_rate = (
                    departed_per_junction[junction] * 3600.0 / interval_for_flow
                    if interval_for_flow > 0
                    else 0.0
                )

                history[junction].append((sim_time, int(vehicle_count)))
                queue_history[junction].append((sim_time, int(queue_length)))
                lag_10 = _value_at_or_before(history[junction], sim_time - 10)
                lag_30 = _value_at_or_before(history[junction], sim_time - 30)
                lag_10_value = lag_10 if lag_10 is not None else vehicle_count
                lag_30_value = lag_30 if lag_30 is not None else vehicle_count
                queue_lag_10 = _value_at_or_before(queue_history[junction], sim_time - 10)
                queue_lag_10_value = queue_lag_10 if queue_lag_10 is not None else queue_length

                state = signal_states[junction]
                green_fraction = sum(1 for ch in state if ch in "gG") / len(state) if state else 0.0

                rows.append(
                    {
                        "run_id": scenario.run_id,
                        "sim_time_s": round(sim_time, 1),
                        "junction_id": junction,
                        "vehicle_count": vehicle_count,
                        "avg_speed_mps": round(avg_speed, 4),
                        "queue_length": queue_length,
                        "density": round(density, 6),
                        "flow_rate_per_hour": round(flow_rate, 2),
                        "signal_phase": phase_index_at(sim_time),
                        "signal_green_fraction": round(green_fraction, 4),
                        "cycle_position_s": round(sim_time % CYCLE_S, 1),
                        "hour": (scenario.start_hour + int(sim_time // 3600)) % 24,
                        "day_of_week": scenario.day_of_week,
                        "count_lag_10s": lag_10_value,
                        "count_lag_30s": lag_30_value,
                        "count_delta_10s": vehicle_count - lag_10_value,
                        "queue_lag_10s": queue_lag_10_value,
                        "queue_delta_10s": queue_length - queue_lag_10_value,
                    }
                )
    finally:
        try:
            connection.close()
        except Exception:
            pass
        if process.poll() is None:
            process.kill()
        try:
            process.wait(timeout=5)
        except Exception:
            pass
        stderr_tail = ""
        try:
            stderr_tail = (process.stderr.read() or b"").decode("utf8", "replace")[-800:]
        except Exception:
            pass
        if stderr_tail.strip():
            print(f"[warn] {scenario.run_id} SUMO stderr: {stderr_tail}", flush=True)
        # Windows holds the route file briefly after the process dies.
        for _ in range(10):
            try:
                route_path.unlink(missing_ok=True)
                break
            except PermissionError:
                time.sleep(0.2)
    return rows


def _value_at_or_before(history: list[tuple[float, int]], when: float) -> int | None:
    value = None
    for time, count in history:
        if time <= when + 1e-9:
            value = count
        else:
            break
    return value


def add_targets(rows: list[dict]) -> list[dict]:
    """Adds target columns by looking up vehicle_count at t+horizon.

    Only rows whose horizon lands inside the same run are kept; targets are
    measured values from the same simulation run.
    """
    by_run: dict[str, dict[tuple[str, float], float]] = {}
    for row in rows:
        by_run.setdefault(row["run_id"], {})[(row["junction_id"], row["sim_time_s"])] = row["vehicle_count"]

    kept: list[dict] = []
    for row in rows:
        lookup = by_run[row["run_id"]]
        targets = {}
        missing = False
        for horizon in HORIZONS_S:
            value = lookup.get((row["junction_id"], row["sim_time_s"] + horizon))
            if value is None:
                missing = True
                break
            targets[f"{TARGET_COLUMN_PREFIX}{horizon}"] = value
        if missing:
            continue
        kept.append({**row, **targets})
    return kept


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate the ITMS prediction dataset")
    parser.add_argument("--runs", type=int, default=16)
    parser.add_argument("--out", type=Path, default=REPO_ROOT / "data" / "traffic" / "processed")
    args = parser.parse_args()

    scenarios = build_scenarios(args.runs)
    workdir = Path(__file__).resolve().parent
    all_rows: list[dict] = []
    started = time.perf_counter()
    for index, scenario in enumerate(scenarios):
        run_started = time.perf_counter()
        rows = collect_run(scenario, workdir)
        all_rows.extend(rows)
        print(
            f"[{index + 1}/{len(scenarios)}] {scenario.run_id}: {len(rows)} samples "
            f"in {time.perf_counter() - run_started:.1f}s "
            f"(demand x{scenario.demand_multiplier}, mix {scenario.route_mix}, "
            f"hour {scenario.start_hour}, incident {scenario.incident_junction})",
            flush=True,
        )

    dataset = add_targets(all_rows)
    args.out.mkdir(parents=True, exist_ok=True)
    out_path = args.out / "training_dataset.csv"
    fieldnames = list(dataset[0].keys()) if dataset else []
    with out_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(dataset)
    print(
        f"dataset: {len(dataset)} rows (from {len(all_rows)} samples) -> {out_path} "
        f"in {time.perf_counter() - started:.1f}s",
        flush=True,
    )


if __name__ == "__main__":
    main()
