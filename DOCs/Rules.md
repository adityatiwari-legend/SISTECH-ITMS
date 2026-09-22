# ITMS — Development Rules

## 1. General Rule

Build a functioning system layer by layer. Never implement UI-only placeholders for functionality that the backend/simulation cannot actually perform.

## 2. Source of Truth

The following are authoritative:
1. Current code
2. Database schema
3. SUMO network/scenario files
4. This documentation
5. Memory.md for current implementation progress

If documentation and implementation conflict, investigate the conflict instead of silently inventing behavior.

## 3. Architecture Rules

- Keep frontend, backend, ML, and simulation responsibilities separate.
- Use TypeScript for frontend/backend.
- Use Python only for the ML/prediction service.
- Do not move ML logic into random frontend components.
- Do not put database logic directly into UI components.
- Keep SUMO/TraCI integration isolated inside the simulation module.
- Prefer modular services over a giant file.

## 4. AI/ML Rules

### Allowed
- XGBoost
- scikit-learn
- Pandas
- NumPy
- Standard time-series/statistical methods

### Initially Avoid
- LLMs
- unnecessary deep learning
- reinforcement learning
- computer vision
- complex GNNs

Only introduce a more complex model when the simpler approach is insufficient and there is measurable benefit.

## 5. Model Rule

The first trained model should be the traffic prediction model.

Do not train a model just to claim the project uses AI.

## 6. Routing Rule

Routing must be deterministic and testable.

Use A* initially.

Do not allow an ML model to directly output arbitrary road routes without validation.

## 7. Green Corridor Rule

The Green Corridor Engine must be an optimization/decision system, not an uncontrolled ML output.

Every signal plan must pass safety constraints.

## 8. Safety Rules

Never:
- Turn every signal green by default.
- Ignore pedestrian phases.
- Ignore downstream congestion.
- Allow unlimited green extensions.
- Create contradictory signal states.
- Assume emergency priority overrides all safety constraints.

## 9. Fallback Rules

If traffic prediction fails:
- Use the most recent valid prediction, or
- use a simple fallback traffic estimate.

If corridor optimization fails:
- fall back to a safe predefined signal strategy.

If SUMO disconnects:
- stop issuing signal commands and expose a clear system error.

## 10. Data Rules

- Validate all incoming data.
- Use timestamps consistently.
- Store simulation data with scenario/run identifiers.
- Never mix baseline and ITMS runs without identifying the scenario.
- Never manually fabricate performance metrics.

## 11. API Rules

- Validate request bodies.
- Return consistent error formats.
- Use HTTP status codes correctly.
- Keep API contracts typed.
- Do not expose internal stack traces to users.

## 12. Database Rules

- Use migrations.
- Add indexes for high-frequency queries.
- Use PostGIS for geographic data.
- Do not duplicate authoritative data unnecessarily.
- Use foreign keys where appropriate.

## 13. Frontend Rules

- UI must reflect real backend state.
- No fake live numbers in the final demo.
- Loading, empty, error, and disconnected states must exist.
- Emergency state must always be visually obvious.
- Map is the primary operational interface.

## 14. UX Rules

Priority hierarchy:

1. Active emergency
2. Green corridor
3. Traffic condition
4. Signals
5. AI decisions
6. Analytics

Do not bury an active emergency beneath charts.

## 15. Code Quality

- Type everything possible.
- Avoid `any` unless justified.
- Keep functions focused.
- Avoid duplicated business logic.
- Use meaningful names.
- Add comments for algorithms, not obvious syntax.
- Log important state transitions.

## 16. Testing Rules

Every major module should have tests.

Required:
- Route tests
- ETA tests
- Corridor tests
- Safety constraint tests
- Prediction evaluation
- API tests
- SUMO integration tests

## 17. Git Rules

Recommended branches:

```text
main
develop
feature/*
fix/*
```

Commits should describe actual changes.

Example:

```text
feat: add emergency route engine
fix: prevent corridor signal conflict
feat: integrate traffic prediction service
```

## 18. Dependency Rule

Before adding a dependency:
- Verify that it solves a real requirement.
- Prefer established libraries.
- Avoid adding multiple libraries that solve the same problem.

## 19. No Premature Complexity

Do not add:
- Kubernetes
- microservices for every tiny feature
- message brokers
- distributed systems
- reinforcement learning

unless the current architecture actually requires them.

## 20. Definition of a Feature Complete

A feature is not complete because its UI exists.

It is complete when:

```text
UI
↓
API
↓
Business Logic
↓
Database/Simulation
↓
Real Result
```

works end to end.

## 21. AI Agent Behavior

When coding:
1. Read the relevant documentation.
2. Inspect existing implementation.
3. Make the smallest coherent change.
4. Run tests/build/lint.
5. Update documentation.
6. Update Memory.md after meaningful progress.
7. Never claim success without verification.

## 22. Never Invent

Do not invent:
- API responses
- database columns
- simulation capabilities
- model performance
- benchmark results
- completed features

If something is unknown, inspect the project or state the uncertainty.
